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
  scheduleId: string
  createdAt: string
  displayName: string
}

export type PreviousRunComparison =
  | { ok: true; search: { a: string; b: string } }
  | { ok: false; reason: 'noPrevious' | 'noOutput' }

interface Fetchers {
  scheduleRuns: (scheduleId: string) => Promise<ScheduleRunsResponse>
  jobStatus: (jobId: string) => Promise<JobExecutionDetail>
}

const defaultFetchers: Fetchers = {
  scheduleRuns: (id) => getScheduleRuns(id, 1, HISTORY_PAGE_SIZE),
  jobStatus: getJobStatus,
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
 * Pair a scheduled run with the completed run of the same schedule issued
 * just before it: same output block on both sides, earlier issue in slot A.
 * Linked layers and exact time-link then compare the two issues by valid time.
 */
export async function buildPreviousRunComparison(
  run: ComparableRun,
  fetchers: Fetchers = defaultFetchers,
): Promise<PreviousRunComparison> {
  const history = await fetchers.scheduleRuns(run.scheduleId)
  const issuedAt = Date.parse(run.createdAt)
  const previous = history.runs
    .filter(
      (r) =>
        r.run_id !== run.runId &&
        r.status === 'completed' &&
        Date.parse(r.created_at) < issuedAt,
    )
    .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))
    .at(0)
  if (!previous) return { ok: false, reason: 'noPrevious' }

  const [current, earlier] = await Promise.all([
    fetchers.jobStatus(run.runId),
    fetchers.jobStatus(previous.run_id),
  ])
  const currentOutput = gribOutputs(current).at(0)
  if (!currentOutput) return { ok: false, reason: 'noOutput' }
  const earlierOutputs = gribOutputs(earlier)
  const earlierOutput =
    earlierOutputs.find((o) => o.blockId === currentOutput.blockId) ??
    earlierOutputs.at(0)
  if (!earlierOutput) return { ok: false, reason: 'noOutput' }

  const ref = (
    jobId: string,
    output: { taskId: string; blockId: string },
    createdAt: string,
  ) =>
    entryRef({
      kind: 'output',
      jobId,
      taskId: output.taskId,
      blockId: output.blockId,
      runName: run.displayName,
      blockTitle: output.blockId,
      runCreatedAt: createdAt,
    })
  return {
    ok: true,
    search: {
      a: ref(previous.run_id, earlierOutput, previous.created_at),
      b: ref(run.runId, currentOutput, run.createdAt),
    },
  }
}
