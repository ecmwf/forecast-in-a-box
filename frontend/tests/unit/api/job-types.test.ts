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
import { JobExecutionDetailSchema } from '@/api/types/job.types'

const baseDetail = {
  run_id: 'run-1',
  attempt_count: 1,
  status: 'running' as const,
  created_at: '2026-05-15T10:00:00',
  updated_at: '2026-05-15T10:05:00',
  blueprint_id: 'def-1',
  blueprint_version: 1,
  error: null,
  progress: '42',
  cascade_job_id: 'cascade-1',
  outputs: null,
}

describe('JobExecutionDetailSchema', () => {
  it('parses a minimal payload without the optional block-id arrays', () => {
    const result = JobExecutionDetailSchema.parse(baseDetail)
    expect(result.completed_block_ids).toBeUndefined()
    expect(result.planned_block_ids).toBeUndefined()
  })

  it('parses populated block-id arrays from /run/get during a running job', () => {
    const result = JobExecutionDetailSchema.parse({
      ...baseDetail,
      completed_block_ids: ['block_source_1'],
      planned_block_ids: ['block_source_1', 'block_product_1', 'block_sink_1'],
    })
    expect(result.completed_block_ids).toEqual(['block_source_1'])
    expect(result.planned_block_ids).toEqual([
      'block_source_1',
      'block_product_1',
      'block_sink_1',
    ])
  })

  it('accepts null for both fields once the backend memcache is popped', () => {
    const result = JobExecutionDetailSchema.parse({
      ...baseDetail,
      status: 'completed',
      completed_block_ids: null,
      planned_block_ids: null,
    })
    expect(result.completed_block_ids).toBeNull()
    expect(result.planned_block_ids).toBeNull()
  })

  it('rejects non-array values in the block-id fields', () => {
    expect(() =>
      JobExecutionDetailSchema.parse({
        ...baseDetail,
        completed_block_ids: 'not-an-array',
      }),
    ).toThrow()
  })
})
