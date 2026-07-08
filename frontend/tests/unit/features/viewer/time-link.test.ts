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
import { buildSourceTimeIndex } from '@/features/viewer/compare/compare-timeline'
import {
  defaultToleranceMs,
  formatOffset,
  resolveSourceTime,
} from '@/features/viewer/compare/time-link'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'

const HOUR = 3600_000

const sixHourly = buildSourceTimeIndex(
  [
    {
      name: '2t',
      title: '2t',
      styles: [],
      time: { raw: '2026-07-06T00:00:00Z/2026-07-07T00:00:00Z/PT6H' },
    } satisfies ParsedLayer,
  ],
  ['2t'],
)
const T00 = Date.parse('2026-07-06T00:00:00Z')

describe('resolveSourceTime', () => {
  it('exact: identical epoch or hidden', () => {
    const hit = resolveSourceTime(sixHourly, T00 + 6 * HOUR, 'exact', HOUR)
    expect(hit.offsetMs).toBe(0)
    expect(hit.raw).toContain('06:00')

    const miss = resolveSourceTime(sixHourly, T00 + 5 * HOUR, 'exact', HOUR)
    expect(miss.hidden).toBe(true)
  })

  it('nearest: snaps within tolerance with a signed offset', () => {
    const snap = resolveSourceTime(
      sixHourly,
      T00 + 5 * HOUR,
      'nearest',
      3 * HOUR,
    )
    expect(snap.hidden).toBe(false)
    expect(snap.epoch).toBe(T00 + 6 * HOUR)
    expect(snap.offsetMs).toBe(HOUR)

    const tooFar = resolveSourceTime(
      sixHourly,
      T00 + 5 * HOUR,
      'nearest',
      0.5 * HOUR,
    )
    expect(tooFar.hidden).toBe(true)
  })

  it('handles empty indexes and null targets as unresolved-visible', () => {
    const empty = buildSourceTimeIndex([], [])
    expect(resolveSourceTime(empty, T00, 'nearest', HOUR).hidden).toBe(false)
    expect(resolveSourceTime(sixHourly, null, 'exact', HOUR).hidden).toBe(false)
  })
})

describe('defaultToleranceMs', () => {
  it('is half the median step, clamped', () => {
    expect(defaultToleranceMs(sixHourly)).toBe(3 * HOUR)
    const empty = buildSourceTimeIndex([], [])
    expect(defaultToleranceMs(empty)).toBe(3 * HOUR)
  })
})

describe('formatOffset', () => {
  it('formats signed hour/minute tags', () => {
    expect(formatOffset(2 * HOUR)).toBe('+2 h')
    expect(formatOffset(-30 * 60_000)).toBe('−30 min')
    expect(formatOffset(90 * 60_000)).toBe('+1 h 30 min')
  })
})
