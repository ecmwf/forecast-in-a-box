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
 * Match running lens servers back to stored run outputs by directory path.
 *
 * A lens instance only exposes `lens_params.local_path`; a stored output
 * only knows its marker task. This hook resolves the GRIB directory of
 * every marker in the most recent runs (1 KB Range reads, cached forever
 * via storedDirQueryOptions) and indexes them by path — the join the
 * backend doesn't provide yet (backend follow-up: echo run_id/dataset_id
 * on the lens instance).
 *
 * Coverage is intentionally page-1-only: older runs' lenses simply show
 * as unmatched.
 */

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { JobExecutionDetail } from '@/api/types/job.types'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { storedDirQueryOptions } from '@/features/executions/outputs/stored-dir'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'

/** Most-recent runs scanned for GRIB markers. */
const INDEXED_RUNS = 20

export interface LensPathMatch {
  jobId: string
  taskId: string
  blockId: string
  runCreatedAt: string | null
}

export interface GribMarkerRow extends LensPathMatch {
  isAvailable: boolean
}

/**
 * One representative marker per sink block per run (a sink fans out to
 * one marker per cascade branch, all pointing at the same directory) —
 * mirrors StoredOutputsCard's row derivation. Only available markers.
 */
export function gribMarkerRows(
  runs: ReadonlyArray<JobExecutionDetail>,
): Array<GribMarkerRow> {
  const rows: Array<GribMarkerRow> = []
  for (const run of runs) {
    if (!run.outputs) continue
    const byBlock = new Map<string, GribMarkerRow>()
    for (const [taskId, meta] of Object.entries(run.outputs)) {
      if (meta.mime_type !== GRIB_DIR_MIME) continue
      const existing = byBlock.get(meta.original_block)
      if (existing) {
        if (!existing.isAvailable && meta.is_available) {
          existing.taskId = taskId
          existing.isAvailable = true
        }
        continue
      }
      byBlock.set(meta.original_block, {
        jobId: run.run_id,
        taskId,
        blockId: meta.original_block,
        runCreatedAt: run.created_at,
        isAvailable: meta.is_available,
      })
    }
    rows.push(...byBlock.values())
  }
  return rows.filter((r) => r.isAvailable)
}

export function useLensPathIndex(): ReadonlyMap<string, LensPathMatch> {
  const { data: jobsList } = useJobsStatus(1, INDEXED_RUNS)

  const markers = useMemo<Array<GribMarkerRow>>(
    () => gribMarkerRows(jobsList?.runs ?? []),
    [jobsList],
  )

  return useQueries({
    queries: markers.map((m) => storedDirQueryOptions(m.jobId, m.taskId)),
    combine: (results) => {
      const index = new Map<string, LensPathMatch>()
      results.forEach((result, i) => {
        if (typeof result.data !== 'string' || !result.data) return
        const { isAvailable: _drop, ...match } = markers[i]
        index.set(result.data, match)
      })
      return index
    },
  })
}
