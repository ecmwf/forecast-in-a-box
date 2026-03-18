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
  getStatusBadgeClasses,
  getStatusBarColor,
} from '@/features/executions/utils/job-status'

const ALL_STATUSES: Array<JobStatus> = [
  'submitted',
  'running',
  'completed',
  'errored',
  'invalid',
  'timeout',
  'unknown',
]

describe('getStatusBadgeClasses', () => {
  it('returns blue classes for submitted', () => {
    expect(getStatusBadgeClasses('submitted')).toContain('bg-blue-100')
  })

  it('returns amber classes for running', () => {
    expect(getStatusBadgeClasses('running')).toContain('bg-amber-100')
  })

  it('returns green classes for completed', () => {
    expect(getStatusBadgeClasses('completed')).toContain('bg-green-100')
  })

  it('returns red classes for errored', () => {
    expect(getStatusBadgeClasses('errored')).toContain('bg-red-100')
  })

  it('returns red classes for invalid', () => {
    expect(getStatusBadgeClasses('invalid')).toContain('bg-red-100')
  })

  it('returns orange classes for timeout', () => {
    expect(getStatusBadgeClasses('timeout')).toContain('bg-orange-100')
  })

  it('returns gray classes for unknown', () => {
    expect(getStatusBadgeClasses('unknown')).toContain('bg-gray-100')
  })

  it('returns a non-empty string for every status', () => {
    for (const status of ALL_STATUSES) {
      expect(getStatusBadgeClasses(status)).toBeTruthy()
    }
  })
})

describe('getStatusBarColor', () => {
  it('returns blue bar for submitted', () => {
    expect(getStatusBarColor('submitted')).toBe('bg-blue-500')
  })

  it('returns amber bar for running', () => {
    expect(getStatusBarColor('running')).toBe('bg-amber-500')
  })

  it('returns green bar for completed', () => {
    expect(getStatusBarColor('completed')).toBe('bg-green-500')
  })

  it('returns red bar for errored', () => {
    expect(getStatusBarColor('errored')).toBe('bg-red-500')
  })

  it('returns a non-empty string for every status', () => {
    for (const status of ALL_STATUSES) {
      expect(getStatusBarColor(status)).toBeTruthy()
    }
  })
})
