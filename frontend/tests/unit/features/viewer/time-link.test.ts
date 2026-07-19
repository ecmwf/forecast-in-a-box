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
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import { buildSourceTimeIndex } from '@/features/viewer/geo/compare-timeline'
import {
  defaultToleranceMs,
  effectiveAvailability,
  formatOffset,
  medianStepMs,
  offsetBounds,
  resolveSourceTime,
} from '@/features/viewer/geo/time-link'

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

describe('effectiveAvailability', () => {
  const axis = [0, 1, 2, 3, 4].map((i) => T00 + i * 6 * HOUR)

  it('exact mode mirrors raw membership', () => {
    expect(effectiveAvailability(axis, sixHourly, 'exact', 0, HOUR)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it('a positive shift slides the usable window off the axis tail', () => {
    // Sampling at t + 12h: the last two axis positions point past the
    // source's final step (T00+24h) and beyond tolerance.
    const shifted = effectiveAvailability(
      axis,
      sixHourly,
      'nearest',
      12 * HOUR,
      3 * HOUR,
    )
    expect(shifted).toEqual([true, true, true, false, false])
  })

  it('an empty source is unavailable everywhere', () => {
    const empty = buildSourceTimeIndex([], [])
    expect(effectiveAvailability(axis, empty, 'nearest', 0, HOUR)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('medianStepMs', () => {
  it('returns the median inter-step interval, 6 h for sparse axes', () => {
    expect(medianStepMs(sixHourly)).toBe(6 * HOUR)
    expect(medianStepMs(buildSourceTimeIndex([], []))).toBe(6 * HOUR)
  })
})

describe('offsetBounds', () => {
  const shifted = buildSourceTimeIndex(
    [
      {
        name: '2t',
        title: '2t',
        styles: [],
        // 12 h later, same span: 2026-07-06T12 … 2026-07-07T12.
        time: { raw: '2026-07-06T12:00:00Z/2026-07-07T12:00:00Z/PT6H' },
      } satisfies ParsedLayer,
    ],
    ['2t'],
  )

  it('spans every Δ where the windows can intersect, containing 0', () => {
    // A: T00…T00+24h, B: T12…T12+24h → Δ ∈ [12−24, 36] h with 0 kept.
    const [min, max] = offsetBounds(sixHourly, shifted)
    expect(min).toBe(-12 * HOUR)
    expect(max).toBe(36 * HOUR)
    expect(offsetBounds(sixHourly, sixHourly)).toEqual([
      -24 * HOUR,
      24 * HOUR,
    ])
  })

  it('falls back to ±48 h when either axis is empty', () => {
    expect(offsetBounds(sixHourly, buildSourceTimeIndex([], []))).toEqual([
      -48 * HOUR,
      48 * HOUR,
    ])
  })
})
