/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import type { JobExecutionDetail } from '@/api/types/job.types'
import type { ScheduleRunsResponse } from '@/api/types/schedule.types'
import { buildPreviousRunComparison } from '@/features/visualise/compare-runs'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'

const run = {
  runId: 'run-3',
  scheduleId: 'sched-1',
  createdAt: '2026-09-06T10:00:00+00:00',
  displayName: 'Daily',
}

function history(
  runs: Array<{ id: string; at: string; status?: string }>,
): ScheduleRunsResponse {
  return {
    runs: runs.map((r) => ({
      run_id: r.id,
      attempt_count: 1,
      status: (r.status ?? 'completed') as 'completed',
      created_at: r.at,
      updated_at: r.at,
      experiment_context: null,
    })),
    total: runs.length,
    page: 1,
    page_size: 50,
    total_pages: 1,
  }
}

function detail(
  outputs: Record<string, { block: string; mime?: string }>,
  lost: Array<string> = [],
): JobExecutionDetail {
  return {
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([task, o]) => [
        task,
        { mime_type: o.mime ?? GRIB_DIR_MIME, original_block: o.block },
      ]),
    ),
    lost_task_ids: Object.fromEntries(lost.map((t) => [t, 'gone'])),
  } as unknown as JobExecutionDetail
}

describe('buildPreviousRunComparison', () => {
  it('pairs the run with the latest earlier completed run, same block, earlier first', async () => {
    const jobs: Record<string, JobExecutionDetail> = {
      'run-3': detail({ t9: { block: 'grib' }, t1: { block: 'zarr' } }),
      'run-2': detail({ t4: { block: 'zarr' }, t5: { block: 'grib' } }),
    }
    const result = await buildPreviousRunComparison(run, {
      scheduleRuns: () =>
        Promise.resolve(
          history([
            { id: 'run-3', at: '2026-09-06T10:00:00+00:00' },
            { id: 'run-2', at: '2026-09-06T09:00:00+00:00' },
            { id: 'run-1', at: '2026-09-06T08:00:00+00:00' },
            { id: 'run-x', at: '2026-09-06T09:30:00+00:00', status: 'failed' },
          ]),
        ),
      jobStatus: (id) => Promise.resolve(jobs[id]),
    })
    expect(result).toEqual({
      ok: true,
      search: { a: 'run:run-2~t5', b: 'run:run-3~t9' },
    })
  })

  it('reports when the schedule has no earlier completed run', async () => {
    const result = await buildPreviousRunComparison(run, {
      scheduleRuns: () =>
        Promise.resolve(
          history([{ id: 'run-3', at: '2026-09-06T10:00:00+00:00' }]),
        ),
      jobStatus: () => Promise.resolve(detail({})),
    })
    expect(result).toEqual({ ok: false, reason: 'noPrevious' })
  })

  it('reports when a side has no retained GRIB output', async () => {
    const jobs: Record<string, JobExecutionDetail> = {
      'run-3': detail({ t9: { block: 'grib' } }, ['t9']),
      'run-2': detail({ t5: { block: 'grib' } }),
    }
    const result = await buildPreviousRunComparison(run, {
      scheduleRuns: () =>
        Promise.resolve(
          history([
            { id: 'run-3', at: '2026-09-06T10:00:00+00:00' },
            { id: 'run-2', at: '2026-09-06T09:00:00+00:00' },
          ]),
        ),
      jobStatus: (id) => Promise.resolve(jobs[id]),
    })
    expect(result).toEqual({ ok: false, reason: 'noOutput' })
  })
})
