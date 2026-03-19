/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Artifacts Hooks
 *
 * TanStack Query hooks for ML model artifact management.
 *
 * Download is asynchronous on the backend: the first POST to /download_model
 * submits a background task and returns immediately with progress 0. The client
 * must poll the same endpoint until status becomes "available". The
 * useDownloadModel hook encapsulates this polling loop so consumers only see
 * a single mutation that resolves when the download is truly complete.
 *
 * Download state is stored in a Zustand store (module-level) so that polling
 * loops and progress survive component unmounts during SPA navigation.
 * Pending download IDs are also persisted to localStorage so that polling
 * can be resumed after a full page refresh.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type {
  ArtifactInfo,
  CompositeArtifactId,
  MlModelDetail,
  MlModelOverview,
} from '@/api/types/artifacts.types'
import {
  decodeArtifactId,
  encodeArtifactId,
  toArtifactInfo,
} from '@/api/types/artifacts.types'
import {
  deleteModel,
  downloadModel,
  getModelDetails,
  listModels,
} from '@/api/endpoints/artifacts'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/** Polling interval for download progress (ms) */
const DOWNLOAD_POLL_INTERVAL = 1_500

/** Query keys for artifacts */
export const artifactKeys = {
  all: ['artifacts'] as const,
  list: () => [...artifactKeys.all, 'list'] as const,
  detail: (compositeId: CompositeArtifactId) =>
    [...artifactKeys.all, 'detail', compositeId] as const,
}

/**
 * Hook to list all ML models as UI-friendly ArtifactInfo array
 */
export function useArtifacts() {
  const query = useQuery<Array<MlModelOverview>>({
    queryKey: artifactKeys.list(),
    queryFn: listModels,
    staleTime: 60 * 1000,
  })

  const artifacts = useMemo<Array<ArtifactInfo>>(() => {
    if (!query.data) return []
    return query.data.map(toArtifactInfo)
  }, [query.data])

  return {
    artifacts,
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}

/**
 * Hook to get model detail
 */
export function useArtifactDetail(compositeId: CompositeArtifactId) {
  return useQuery<MlModelDetail>({
    queryKey: artifactKeys.detail(compositeId),
    queryFn: () => getModelDetails(compositeId),
    staleTime: 60 * 1000,
    enabled:
      !!compositeId.artifact_store_id && !!compositeId.ml_model_checkpoint_id,
  })
}

/** State tracked per in-flight download */
export interface DownloadProgress {
  compositeId: CompositeArtifactId
  /** 0-100 */
  progress: number
  status: string
}

/**
 * Wait for a delay, cancellable via AbortSignal.
 */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

// ---------------------------------------------------------------------------
// localStorage helpers for persisting pending download IDs across refreshes
// ---------------------------------------------------------------------------

function loadPendingDownloads(): Array<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.artifacts.pendingDownloads)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as Array<string>
    return []
  } catch {
    return []
  }
}

function savePendingDownload(key: string) {
  const current = loadPendingDownloads()
  if (!current.includes(key)) {
    current.push(key)
    localStorage.setItem(
      STORAGE_KEYS.artifacts.pendingDownloads,
      JSON.stringify(current),
    )
  }
}

function removePendingDownload(key: string) {
  const current = loadPendingDownloads()
  const updated = current.filter((k) => k !== key)
  if (updated.length > 0) {
    localStorage.setItem(
      STORAGE_KEYS.artifacts.pendingDownloads,
      JSON.stringify(updated),
    )
  } else {
    localStorage.removeItem(STORAGE_KEYS.artifacts.pendingDownloads)
  }
}

// ---------------------------------------------------------------------------
// Zustand store for download state (survives SPA navigation)
// ---------------------------------------------------------------------------

interface DownloadStore {
  downloads: Record<string, DownloadProgress>
  setProgress: (key: string, value: DownloadProgress) => void
  removeProgress: (key: string) => void
}

const useDownloadStore = create<DownloadStore>()((set) => ({
  downloads: {},
  setProgress: (key, value) =>
    set((state) => ({ downloads: { ...state.downloads, [key]: value } })),
  removeProgress: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.downloads
      return { downloads: rest }
    }),
}))

/** Module-level abort controllers — not in Zustand since they're not serialisable */
const abortControllers = new Map<string, AbortController>()

/**
 * Start a download polling loop for a model.
 * Runs independently of React component lifecycle.
 */
async function startDownloadPolling(
  compositeId: CompositeArtifactId,
  onComplete?: () => void,
) {
  const key = encodeArtifactId(compositeId)

  // Already downloading this model — don't start a second loop
  if (abortControllers.has(key)) return

  const controller = new AbortController()
  abortControllers.set(key, controller)

  // Persist to localStorage so we can resume after page refresh
  savePendingDownload(key)

  useDownloadStore
    .getState()
    .setProgress(key, { compositeId, progress: 0, status: 'submitting' })

  try {
    for (;;) {
      controller.signal.throwIfAborted()

      const response = await downloadModel(compositeId)
      const progress = response.progress ?? 0
      const status = response.status

      useDownloadStore
        .getState()
        .setProgress(key, { compositeId, progress, status })

      if (status === 'available') {
        onComplete?.()
        return response
      }

      await wait(DOWNLOAD_POLL_INTERVAL, controller.signal)
    }
  } finally {
    abortControllers.delete(key)
    removePendingDownload(key)
    useDownloadStore.getState().removeProgress(key)
  }
}

/**
 * Hook to download a model with polling until completion.
 *
 * Download polling runs at module level and survives SPA navigation.
 * Pending download IDs are persisted to localStorage so that polling
 * resumes automatically after a full page refresh.
 */
export function useDownloadModel() {
  const queryClient = useQueryClient()
  const downloads = useDownloadStore((state) => state.downloads)
  const hasResumed = useRef(false)

  // On first mount, resume polling for any downloads that were in progress
  // before the page was refreshed.
  useEffect(() => {
    if (hasResumed.current) return
    hasResumed.current = true

    const pending = loadPendingDownloads()
    for (const key of pending) {
      const compositeId = decodeArtifactId(key)
      if (!compositeId.artifact_store_id || !compositeId.ml_model_checkpoint_id)
        continue

      startDownloadPolling(compositeId, () => {
        queryClient.invalidateQueries({ queryKey: artifactKeys.list() })
        queryClient.invalidateQueries({
          queryKey: artifactKeys.detail(compositeId),
        })
      }).catch(() => {
        // AbortError or network error — ignore
      })
    }
  }, [queryClient])

  const mutate = useCallback(
    (compositeId: CompositeArtifactId) => {
      startDownloadPolling(compositeId, () => {
        queryClient.invalidateQueries({ queryKey: artifactKeys.list() })
        queryClient.invalidateQueries({
          queryKey: artifactKeys.detail(compositeId),
        })
      }).catch(() => {
        // AbortError is expected when cancelling — ignore
      })
    },
    [queryClient],
  )

  const isDownloading = useCallback(
    (compositeId: CompositeArtifactId): boolean => {
      return encodeArtifactId(compositeId) in downloads
    },
    [downloads],
  )

  const getProgress = useCallback(
    (compositeId: CompositeArtifactId): number | undefined => {
      const key = encodeArtifactId(compositeId)
      if (!(key in downloads)) return undefined
      return downloads[key].progress
    },
    [downloads],
  )

  const cancel = useCallback((compositeId: CompositeArtifactId) => {
    const key = encodeArtifactId(compositeId)
    abortControllers.get(key)?.abort()
  }, [])

  return {
    mutate,
    isDownloading,
    getProgress,
    cancel,
    downloads,
  }
}

/**
 * Hook to delete a model
 */
export function useDeleteModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteModel,
    onSuccess: (_data, compositeId) => {
      queryClient.invalidateQueries({ queryKey: artifactKeys.list() })
      queryClient.invalidateQueries({
        queryKey: artifactKeys.detail(compositeId),
      })
    },
  })
}
