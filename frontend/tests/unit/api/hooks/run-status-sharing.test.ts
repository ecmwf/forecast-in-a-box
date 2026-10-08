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
import type { JobStatus } from '@/api/types/job.types'
import {
  keepKnownStatus,
  shareRunDetail,
  shareRunList,
} from '@/api/hooks/run-status-sharing'

const row = (status: JobStatus, attempt = 1, runId = 'run-1') => ({
  run_id: runId,
  attempt_count: attempt,
  status,
})

describe('keepKnownStatus', () => {
  it('keeps an active status through a busy-gateway unknown', () => {
    expect(keepKnownStatus(row('stopping'), row('unknown')).status).toBe(
      'stopping',
    )
    expect(keepKnownStatus(row('running'), row('unknown')).status).toBe(
      'running',
    )
  })

  it('passes unknown through when there is nothing active to keep', () => {
    expect(keepKnownStatus(undefined, row('unknown')).status).toBe('unknown')
    expect(keepKnownStatus(row('stopped'), row('unknown')).status).toBe(
      'unknown',
    )
    expect(keepKnownStatus(row('unknown'), row('unknown')).status).toBe(
      'unknown',
    )
    // A new attempt has no history of its own yet.
    expect(keepKnownStatus(row('running', 1), row('unknown', 2)).status).toBe(
      'unknown',
    )
  })

  it('never masks a real status change', () => {
    expect(keepKnownStatus(row('stopping'), row('stopped')).status).toBe(
      'stopped',
    )
  })
})

describe('structural sharing', () => {
  it('keeps the detail status and stays referentially stable', () => {
    const prev = { ...row('stopping'), progress: '10' }
    expect(shareRunDetail(prev, { ...row('unknown'), progress: '10' })).toBe(
      prev,
    )
  })

  it('merges select output (not a run list) as usual', () => {
    const prev = [row('running')]
    const next = [row('completed')]
    expect(shareRunList(prev, next)).toEqual(next)
    expect(shareRunDetail({ running: 1 }, { running: 2 })).toEqual({
      running: 2,
    })
  })

  it('matches list rows by run id', () => {
    const prev = { runs: [row('running', 1, 'a'), row('completed', 1, 'b')] }
    const next = { runs: [row('unknown', 1, 'a'), row('unknown', 1, 'b')] }
    const shared = shareRunList(prev, next) as typeof next
    expect(shared.runs.map((r) => r.status)).toEqual(['running', 'unknown'])
  })
})
