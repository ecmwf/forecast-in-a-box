/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { entryRef } from './entry-ref'
import type { JobExecutionDetail } from '@/api/types/job.types'
import type { ScheduleRunsResponse } from '@/api/types/schedule.types'
import { getJobStatus } from '@/api/endpoints/job'
import { getScheduleRuns } from '@/api/endpoints/schedule'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'

/** How far back the schedule's run history is searched for a comparison partner. */
const HISTORY_PAGE_SIZE = 50

export interface ComparableRun {
  runId: string
  createdAt: string
  displayName: string
}

export type RunPairComparison =
  | { ok: true; search: { a: string; b: string } }
  | { ok: false; reason: 'noOutput' }

export type PreviousRunComparison =
  RunPairComparison | { ok: false; reason: 'noPrevious' }

interface Fetchers {
  scheduleRuns: (scheduleId: string) => Promise<ScheduleRunsResponse>
  jobStatus: (jobId: string) => Promise<JobExecutionDetail>
}

const defaultFetchers: Fetchers = {
  scheduleRuns: (id) => getScheduleRuns(id, 1, HISTORY_PAGE_SIZE),
  jobStatus: getJobStatus,
}

/** Backend timestamps vary in separator and precision; both parse as UTC. */
function serverInstant(value: string): number {
  return Date.parse(
    value
      .trim()
      .replace(' ', 'T')
      .replace(/(\.\d{3})\d+/, '$1'),
  )
}

/** Stored GRIB outputs still on disk, keyed by task id. */
function gribOutputs(detail: JobExecutionDetail) {
  return Object.entries(detail.outputs ?? {})
    .filter(
      ([taskId, meta]) =>
        meta.mime_type === GRIB_DIR_MIME && !(taskId in detail.lost_task_ids),
    )
    .map(([taskId, meta]) => ({ taskId, blockId: meta.original_block }))
}

/**
 * Put two runs of one configuration side by side: the same output block on
 * both sides, the earlier issue in slot A. Linked layers and the exact
 * time-link then compare the issues by valid time.
 */
export async function buildRunPairComparison(
  first: ComparableRun,
  second: ComparableRun,
  fetchers: Fetchers = defaultFetchers,
): Promise<RunPairComparison> {
  const [earlier, later] =
    serverInstant(first.createdAt) <= serverInstant(second.createdAt)
      ? [first, second]
      : [second, first]
  const [laterDetail, earlierDetail] = await Promise.all([
    fetchers.jobStatus(later.runId),
    fetchers.jobStatus(earlier.runId),
  ])
  const laterOutput = gribOutputs(laterDetail).at(0)
  if (!laterOutput) return { ok: false, reason: 'noOutput' }
  const earlierOutputs = gribOutputs(earlierDetail)
  const earlierOutput =
    earlierOutputs.find((o) => o.blockId === laterOutput.blockId) ??
    earlierOutputs.at(0)
  if (!earlierOutput) return { ok: false, reason: 'noOutput' }

  const ref = (
    run: ComparableRun,
    output: { taskId: string; blockId: string },
  ) =>
    entryRef({
      kind: 'output',
      jobId: run.runId,
      taskId: output.taskId,
      blockId: output.blockId,
      runName: run.displayName,
      blockTitle: output.blockId,
      runCreatedAt: run.createdAt,
    })
  return {
    ok: true,
    search: { a: ref(earlier, earlierOutput), b: ref(later, laterOutput) },
  }
}

/**
 * Pair a scheduled run with the completed run of the same schedule issued
 * just before it. The history endpoint lists newest first, so the partner is
 * the next completed entry; timestamps only decide when the run is not on
 * the first page.
 */
export async function buildPreviousRunComparison(
  run: ComparableRun & { scheduleId: string },
  fetchers: Fetchers = defaultFetchers,
): Promise<PreviousRunComparison> {
  const history = (await fetchers.scheduleRuns(run.scheduleId)).runs
  const index = history.findIndex((r) => r.run_id === run.runId)
  const candidates =
    index >= 0
      ? history.slice(index + 1)
      : history.filter(
          (r) => serverInstant(r.created_at) < serverInstant(run.createdAt),
        )
  const previous = candidates.find((r) => r.status === 'completed')
  if (!previous) return { ok: false, reason: 'noPrevious' }
  return buildRunPairComparison(
    run,
    {
      runId: previous.run_id,
      createdAt: previous.created_at,
      displayName: run.displayName,
    },
    fetchers,
  )
}
