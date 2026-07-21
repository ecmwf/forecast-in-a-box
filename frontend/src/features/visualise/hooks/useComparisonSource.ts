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
 * Resolve a comparison entry to a browser-reachable WMS base URL.
 *
 * Per source kind:
 *  - `wms`    → immediately running (the capabilities fetch is the health
 *               check downstream)
 *  - `output` → resolve the GRIB dir from the marker payload, then ↓
 *  - `path`   → match an already-running lens by `local_path`, else
 *               auto-start one, then poll until running
 *
 * Idempotency: two panels resolving to the same path must start exactly
 * ONE lens. A module-level in-flight map dedupes concurrent starts across
 * hook instances; a per-instance attempted-set stops effect re-runs (list
 * refetch ticks) from re-firing. Lenses are never auto-stopped on leave —
 * the page offers an explicit "Stop lens servers" action, which flips
 * `autoStart` off so panels don't instantly restart.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComparisonEntry } from '../entry-ref'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import {
  useLensList,
  useLensStatus,
  useStartSkinnyWms,
} from '@/api/hooks/useLens'
import { buildLensBaseUrl } from '@/api/endpoints/lens'
import { ApiClientError } from '@/api/client'
import { useStoredDirPath } from '@/features/executions/outputs/stored-dir'

export type ComparisonSourceState =
  | { phase: 'idle' }
  | { phase: 'resolvingDir' }
  | { phase: 'dirError'; error: string; retry: () => void }
  | { phase: 'starting' }
  | {
      phase: 'running'
      baseUrl: string
      /** null for external `wms` sources (no lens involved). */
      lensId: string | null
      localPath: string | null
    }
  | { phase: 'failed'; error: string | null; retry: () => void }
  /** No lens and auto-start suppressed (user stopped the servers). */
  | { phase: 'stopped'; start: () => void }

/** In-flight lens starts keyed by path — shared across hook instances. */
const pendingStartByPath = new Map<string, Promise<string>>()
const startedIdByPath = new Map<string, string>()

function ensureLensStarted(
  path: string,
  start: (p: string) => Promise<string>,
): Promise<string> {
  const existing = pendingStartByPath.get(path)
  if (existing) return existing
  // Resolved promises stay cached: a sibling panel resolving its dir just
  // after the start completes must adopt this lens, not start a second one
  // (the 5 s lens-list poll lags). Failures and vanished lenses evict.
  const promise = start(path).then(
    (id) => {
      startedIdByPath.set(path, id)
      return id
    },
    (err: unknown) => {
      evictLensStart(path)
      throw err
    },
  )
  pendingStartByPath.set(path, promise)
  return promise
}

/** With `goneLensId`, evict only the start that actually died — a
 *  sibling's fresh start (pending or resolved to a new id) must survive. */
function evictLensStart(path: string, goneLensId?: string): void {
  if (goneLensId !== undefined && startedIdByPath.get(path) !== goneLensId) {
    return
  }
  pendingStartByPath.delete(path)
  startedIdByPath.delete(path)
}

function pickMatchedLens(
  lenses: ReadonlyArray<LensInstanceDetailResponse> | undefined,
  localPath: string | null,
): LensInstanceDetailResponse | undefined {
  if (!lenses || !localPath) return undefined
  const candidates = lenses.filter(
    (l) =>
      l.lens_params.local_path === localPath &&
      (l.status === 'running' || l.status === 'starting'),
  )
  return candidates.find((l) => l.status === 'running') ?? candidates[0]
}

export function useComparisonSource(
  entry: ComparisonEntry | null,
  options: { autoStart: boolean },
): ComparisonSourceState {
  const { autoStart } = options
  const isOutput = entry?.kind === 'output'

  // 1) Resolve the directory (output entries only; a path IS the dir).
  const dirQuery = useStoredDirPath(
    isOutput ? entry.jobId : '',
    isOutput ? entry.taskId : '',
    isOutput,
  )
  const localPath =
    entry?.kind === 'path'
      ? entry.path
      : isOutput
        ? (dirQuery.data ?? null)
        : null

  // 2) Match a lens that already serves this path (page-wide 5 s poll).
  const lensListQuery = useLensList()
  const matched = pickMatchedLens(lensListQuery.data, localPath)

  // 3) Auto-start when nothing matches.
  const startMutation = useStartSkinnyWms()
  const [startedLensId, setStartedLensId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const attemptedPathsRef = useRef<Set<string>>(new Set())

  const startForPath = useCallback(
    (path: string) => {
      attemptedPathsRef.current.add(path)
      setStartError(null)
      ensureLensStarted(path, (p) =>
        startMutation.mutateAsync({ localPath: p }),
      ).then(
        (id) => setStartedLensId(id),
        (err: unknown) =>
          setStartError(err instanceof Error ? err.message : String(err)),
      )
    },
    [startMutation],
  )

  useEffect(() => {
    if (!entry || entry.kind === 'wms') return
    if (!autoStart || !localPath) return
    if (matched || startedLensId || startError) return
    if (!lensListQuery.isSuccess) return
    if (attemptedPathsRef.current.has(localPath)) return
    startForPath(localPath)
  }, [
    entry,
    autoStart,
    localPath,
    matched,
    startedLensId,
    startError,
    lensListQuery.isSuccess,
    startForPath,
  ])

  // 4) Poll the owned/matched instance (1 s while starting).
  const lensId = matched?.lens_instance_id ?? startedLensId ?? undefined
  const statusQuery = useLensStatus(entry?.kind === 'wms' ? undefined : lensId)
  const detail = statusQuery.data ?? matched

  // A 404 on the status poll means the instance vanished (stopped from
  // this page or elsewhere) — that's "gone", not "failed". Forget it so
  // the state machine re-derives: auto-start restarts it, or a paused
  // page lands on `stopped` with a manual Start.
  const statusGone =
    statusQuery.isError &&
    statusQuery.error instanceof ApiClientError &&
    statusQuery.error.status === 404
  useEffect(() => {
    if (!statusGone || !startedLensId) return
    setStartedLensId(null)
    if (localPath) {
      attemptedPathsRef.current.delete(localPath)
      evictLensStart(localPath, startedLensId)
    }
  }, [statusGone, startedLensId, localPath])

  const retry = useCallback(() => {
    if (localPath) {
      attemptedPathsRef.current.delete(localPath)
      evictLensStart(localPath)
    }
    setStartedLensId(null)
    setStartError(null)
  }, [localPath])

  // -------- Phase derivation --------

  if (!entry) return { phase: 'idle' }
  if (entry.kind === 'wms') {
    return {
      phase: 'running',
      baseUrl: entry.url,
      lensId: null,
      localPath: null,
    }
  }
  if (isOutput && dirQuery.isError) {
    return {
      phase: 'dirError',
      error: dirQuery.error.message,
      retry: () => void dirQuery.refetch(),
    }
  }
  if (!localPath) return { phase: 'resolvingDir' }

  const terminal =
    startError !== null ||
    (!!lensId && statusQuery.isError && !statusGone) ||
    detail?.status === 'failed' ||
    detail?.status === 'terminated'
  if (terminal) {
    return {
      phase: 'failed',
      error: startError ?? statusQuery.error?.message ?? null,
      retry,
    }
  }

  const port = detail?.status === 'running' ? detail.ports[0] : undefined
  if (detail && port !== undefined) {
    return {
      phase: 'running',
      baseUrl: buildLensBaseUrl(port),
      lensId: detail.lens_instance_id,
      localPath,
    }
  }

  // Nothing running/starting and auto-start is off → explicit start.
  if (!autoStart && !lensId && !startMutation.isPending) {
    return { phase: 'stopped', start: () => startForPath(localPath) }
  }
  return { phase: 'starting' }
}
