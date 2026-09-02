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
 * Pure step policy: which advance conditions count as already satisfied at
 * step entry (→ review mode), and the progress label.
 */

import { describe, expect, it } from 'vitest'
import {
  isPreSatisfied,
  stepProgress,
} from '@/features/tutorials/engine/stepMachine'

describe('isPreSatisfied', () => {
  it('next-click steps never pre-satisfy', () => {
    expect(isPreSatisfied({ kind: 'next-click' }, {})).toBe(false)
  })

  it('search checks compare the live search against itself', () => {
    // State-shaped ("la is non-empty") pre-satisfies…
    const stateShaped = {
      kind: 'search',
      check: (s: Record<string, unknown>) => typeof s.la === 'string',
    } as const
    expect(isPreSatisfied(stateShaped, { la: '2t' })).toBe(true)
    expect(isPreSatisfied(stateShaped, {})).toBe(false)
    // …change-shaped ("t differs from entry") never does.
    const changeShaped = {
      kind: 'search',
      check: (s: Record<string, unknown>, at: Record<string, unknown>) =>
        s.t !== at.t,
    } as const
    expect(isPreSatisfied(changeShaped, { t: 123 })).toBe(false)
  })

  it('signal checks run against the tour-supplied state', () => {
    let count = 0
    const advance = {
      kind: 'signal',
      subscribe: () => () => {},
      check: () => count > 0,
    } as const
    expect(isPreSatisfied(advance, {})).toBe(false)
    count = 1
    expect(isPreSatisfied(advance, {})).toBe(true)
  })
})

describe('stepProgress', () => {
  it('reports a 1-based position over the fixed step count', () => {
    expect(stepProgress(10, 0)).toEqual({ current: 1, total: 10 })
    expect(stepProgress(10, 9)).toEqual({ current: 10, total: 10 })
  })

  it('never exceeds the total or drops below one', () => {
    expect(stepProgress(3, 7)).toEqual({ current: 3, total: 3 })
    expect(stepProgress(0, 0)).toEqual({ current: 1, total: 1 })
  })
})
