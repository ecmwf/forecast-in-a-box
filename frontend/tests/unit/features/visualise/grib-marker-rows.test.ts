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
import type { JobExecutionDetail, RunOutputs } from '@/api/types/job.types'
import { gribMarkerRows } from '@/features/visualise/hooks/useLensPathIndex'
import { GRIB_DIR_MIME } from '@/features/executions/outputs/adapters/grib'

function run(
  outputs: RunOutputs,
  lost: JobExecutionDetail['lost_task_ids'] = {},
): JobExecutionDetail {
  return {
    run_id: 'job-1',
    attempt_count: 1,
    status: 'completed',
    created_at: '2026-07-20T10:00:00',
    updated_at: '2026-07-20T10:00:00',
    blueprint_id: 'bp-1',
    blueprint_version: 1,
    error: null,
    progress: '100',
    cascade_job_id: 'cascade-1',
    lost_task_ids: lost,
    outputs,
  }
}

function gribMarker(block: string, isAvailable: boolean) {
  return {
    mime_type: GRIB_DIR_MIME,
    original_block: block,
    is_available: isAvailable,
  }
}

describe('gribMarkerRows', () => {
  it('marks a lost sink block with the backend reason instead of dropping it', () => {
    const rows = gribMarkerRows([
      run(
        { 'task-a': gribMarker('sink', false) },
        { 'task-a': 'Gateway Proc changed' },
      ),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].availability).toEqual({
      state: 'lost',
      reason: 'Gateway Proc changed',
    })
  })

  it('prefers an available marker as the representative for a fanned-out sink', () => {
    const rows = gribMarkerRows([
      run(
        {
          'task-a': gribMarker('sink', false),
          'task-b': gribMarker('sink', true),
        },
        { 'task-a': 'Gateway Proc changed' },
      ),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].taskId).toBe('task-b')
    expect(rows[0].availability.state).toBe('available')
  })

  it('keeps available markers available', () => {
    const rows = gribMarkerRows([run({ 'task-a': gribMarker('sink', true) })])
    expect(rows[0].availability).toEqual({ state: 'available' })
  })
})
