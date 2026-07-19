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
 *  - `path:`/`wms:` refs are self-contained
 *  - `run:` refs are checked against the run's outputs (must be a GRIB
 *    marker) before adding; unknown runs/tasks are stripped from the URL
 *    with a toast, so a stale link degrades instead of wedging the page.
 * Display metadata arrives later via useEnrichComparisonEntry.
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { SLOT_B_OFF, decodeEntryRef, entryRef } from '../entry-ref'
import { useComparisonStore } from '../stores/comparisonStore'
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

export function useHydrateComparisonFromUrl(): void {
  const { t } = useTranslation('visualise')
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const queryClient = useQueryClient()
  const addEntry = useComparisonStore((s) => s.addEntry)
  const entries = useComparisonStore((s) => s.entries)
  // Refs already handled this mount — failures must not retry in a loop.
  const processedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const strip = (ref: string) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          a: prev.a === ref ? undefined : prev.a,
          b: prev.b === ref ? undefined : prev.b,
        }),
        replace: true,
      })
    }

    for (const ref of [search.a, search.b]) {
      if (!ref || ref === SLOT_B_OFF || processedRef.current.has(ref)) continue
      if (entries.some((e) => entryRef(e) === ref)) continue
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
        addEntry({
          kind: 'wms',
          url: decoded.url,
          label: urlLabel(decoded.url),
        })
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
            showToast.error(t('toast.full', { max: 8 }))
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
  }, [search.a, search.b, entries, addEntry, navigate, queryClient, t])
}
