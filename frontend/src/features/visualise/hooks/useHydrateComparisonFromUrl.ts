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
 * Hydrate the basket from a shared /compare URL. `a`/`b` refs that are not
 * in the local basket are validated and added as stub entries:
 *  - `path:` refs are self-contained
 *  - `wms:` refs are held in `pendingExternal` until explicitly confirmed
 *  - `run:` refs are checked against the run's outputs (must be a GRIB
 *    marker) before adding; unknown runs/tasks are stripped from the URL
 *    with a toast, so a stale link degrades instead of wedging the page.
 * Display metadata arrives later via useEnrichComparisonEntry.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { SLOT_B_OFF, decodeEntryRef, entryRef } from '../entry-ref'
import {
  MAX_COMPARISON_ENTRIES,
  useComparisonStore,
} from '../stores/comparisonStore'
import { allowedWmsUrl } from '../wms-probe'
import { jobKeys } from '@/api/hooks/useJobs'
import { getJobStatus } from '@/api/endpoints/job'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'

const log = createLogger('useHydrateComparisonFromUrl')
const route = getRouteApi('/_authenticated/visualise')

/** Default label for hydrated path entries: the last path segment. */
function pathLabel(path: string): string {
  const parts = path.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || path
}

/** Default label for hydrated wms entries: the hostname when parseable. */
function urlLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** External `wms:` ref awaiting the user's explicit go-ahead. */
export interface PendingExternalSource {
  ref: string
  url: string
}

export interface HydrateComparisonResult {
  /** External servers a shared link wants to add — confirm before contact. */
  pendingExternal: ReadonlyArray<PendingExternalSource>
  resolveExternal: (action: 'add' | 'ignore') => void
}

export function useHydrateComparisonFromUrl(): HydrateComparisonResult {
  const { t } = useTranslation('visualise')
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const addEntry = useComparisonStore((s) => s.addEntry)
  const entries = useComparisonStore((s) => s.entries)
  // Refs already handled this mount — failures must not retry in a loop.
  const processedRef = useRef<Set<string>>(new Set())
  const [pendingExternal, setPendingExternal] = useState<
    Array<PendingExternalSource>
  >([])

  const strip = useCallback(
    (ref: string) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          a: prev.a === ref ? undefined : prev.a,
          b: prev.b === ref ? undefined : prev.b,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const resolveExternal = useCallback(
    (action: 'add' | 'ignore') => {
      for (const { ref, url } of pendingExternal) {
        if (action === 'add') {
          const result = addEntry({ kind: 'wms', url, label: urlLabel(url) })
          if (result === 'full') {
            showToast.error(t('toast.full', { max: MAX_COMPARISON_ENTRIES }))
            strip(ref)
          }
        } else {
          strip(ref)
        }
      }
      setPendingExternal([])
    },
    [pendingExternal, addEntry, strip, t],
  )

  useEffect(() => {
    for (const ref of [search.a, search.b]) {
      if (!ref || ref === SLOT_B_OFF || processedRef.current.has(ref)) continue
      if (entries.some((e) => entryRef(e) === ref)) {
        // Known ref: mark it handled so a later basket clear (races the
        // async URL update) cannot resurrect it as a stub.
        processedRef.current.add(ref)
        continue
      }
      processedRef.current.add(ref)

      const decoded = decodeEntryRef(ref)
      if (!decoded) {
        showToast.error(t('toast.invalidLink'))
        strip(ref)
        continue
      }
      if (decoded.kind === 'path') {
        addEntry({
          kind: 'path',
          path: decoded.path,
          label: pathLabel(decoded.path),
        })
        continue
      }
      if (decoded.kind === 'wms') {
        // Scheme-checked, then held for confirmation — a crafted link
        // must not drive-by-connect or persist an external server.
        if (!allowedWmsUrl(decoded.url)) {
          showToast.error(t('toast.invalidLink'))
          strip(ref)
          continue
        }
        setPendingExternal((prev) =>
          prev.some((p) => p.ref === ref)
            ? prev
            : [...prev, { ref, url: decoded.url }],
        )
        continue
      }

      // `run:` — validate the task is a stored-output marker of that run.
      void queryClient
        .ensureQueryData({
          queryKey: jobKeys.status(decoded.jobId),
          queryFn: () => getJobStatus(decoded.jobId),
        })
        .then((detail) => {
          const meta = detail.outputs?.[decoded.taskId]
          if (meta?.mime_type !== GRIB_DIR_MIME) {
            throw new Error(`task ${decoded.taskId} is not a stored output`)
          }
          if (decoded.taskId in detail.lost_task_ids) {
            const reason = detail.lost_task_ids[decoded.taskId]
            showToast.error(t('toast.sourceLost', { reason }))
            strip(ref)
            return
          }
          const result = addEntry({
            kind: 'output',
            jobId: decoded.jobId,
            taskId: decoded.taskId,
            blockId: meta.original_block,
            runName: '',
            blockTitle: meta.original_block,
            runCreatedAt: detail.created_at,
          })
          if (result === 'full') {
            showToast.error(t('toast.full', { max: MAX_COMPARISON_ENTRIES }))
            strip(ref)
          }
        })
        .catch((err: unknown) => {
          log.error('Failed to hydrate comparison source from URL', {
            ref,
            error: err,
          })
          showToast.error(t('toast.unknownSource'))
          strip(ref)
        })
    }
  }, [search.a, search.b, entries, addEntry, strip, queryClient, t])

  return { pendingExternal, resolveExternal }
}
