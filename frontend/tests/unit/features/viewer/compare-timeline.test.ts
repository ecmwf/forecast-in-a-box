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
import {
  availabilityRange,
  buildCompareTimeline,
  buildSourceTimeIndex,
  locateEpoch,
  overlapRange,
} from '@/features/viewer/geo/compare-timeline'

const timedLayer = (name: string, raw: string): ParsedLayer => ({
  name,
  title: name,
  styles: [],
  time: { raw },
})

describe('buildSourceTimeIndex', () => {
  it('unions steps of active time-aware layers, keyed by epoch', () => {
    const layers = [
      timedLayer('2t', '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z'),
      timedLayer('msl', '2026-07-06T06:00:00Z,2026-07-06T12:00:00Z'),
    ]
    const index = buildSourceTimeIndex(layers, ['2t', 'msl'])
    expect(index.epochs).toHaveLength(3)
    expect(index.rawByEpoch.get(Date.parse('2026-07-06T06:00:00Z'))).toBe(
      '2026-07-06T06:00:00Z',
    )
  })

  it('ignores inactive layers and non-parseable steps', () => {
    const layers = [
      timedLayer('2t', '2026-07-06T00:00:00Z'),
      timedLayer('junk', 'not-a-date'),
    ]
    expect(buildSourceTimeIndex(layers, ['junk']).epochs).toHaveLength(0)
    expect(buildSourceTimeIndex(layers, ['2t']).epochs).toHaveLength(1)
  })
})

describe('buildCompareTimeline', () => {
  it('merges different string forms of the same instant into one epoch', () => {
    // Server A: literal list; server B: expanded interval with .000Z forms.
    const a = buildSourceTimeIndex(
      [timedLayer('2t', '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z')],
      ['2t'],
    )
    const b = buildSourceTimeIndex(
      [timedLayer('2t', '2026-07-06T00:00:00Z/2026-07-06T06:00:00Z/PT6H')],
      ['2t'],
    )
    const timeline = buildCompareTimeline(a, b)
    expect(timeline.epochs).toHaveLength(2)
    expect(timeline.intersectionCount).toBe(2)
    // Each source keeps ITS advertised raw string for the shared epoch.
    const epoch = Date.parse('2026-07-06T06:00:00Z')
    expect(a.rawByEpoch.get(epoch)).toBe('2026-07-06T06:00:00Z')
    expect(b.rawByEpoch.get(epoch)).toBe('2026-07-06T06:00:00.000Z')
  })

  it('flags per-source availability across the union', () => {
    const a = buildSourceTimeIndex(
      [timedLayer('2t', '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z')],
      ['2t'],
    )
    const b = buildSourceTimeIndex(
      [timedLayer('2t', '2026-07-06T06:00:00Z,2026-07-06T12:00:00Z')],
      ['2t'],
    )
    const timeline = buildCompareTimeline(a, b)
    expect(timeline.epochs).toHaveLength(3)
    expect(timeline.availability.a).toEqual([true, true, false])
    expect(timeline.availability.b).toEqual([false, true, true])
    expect(timeline.intersectionCount).toBe(1)
  })
})

describe('locateEpoch', () => {
  const epochs = [0, 3600_000, 7200_000]
  it('re-locates the nearest epoch after the union changes', () => {
    expect(locateEpoch(epochs, 3600_000)).toBe(1)
    expect(locateEpoch(epochs, 3599_000)).toBe(1)
    expect(locateEpoch(epochs, 10_000_000)).toBe(2)
    expect(locateEpoch(epochs, null)).toBe(0)
    expect(locateEpoch([], 0)).toBe(-1)
  })
})

describe('availabilityRange / overlapRange', () => {
  it('finds first/last availability and the shared window', () => {
    const a = [false, true, true, false, true, false]
    const b = [false, false, true, true, true, true]
    expect(availabilityRange(a)).toEqual([1, 4])
    expect(availabilityRange(b)).toEqual([2, 5])
    expect(overlapRange(a, b)).toEqual([2, 4])
  })

  it('returns null for empty availability or disjoint ranges', () => {
    expect(availabilityRange([false, false])).toBeNull()
    expect(overlapRange([true, false, false], [false, false, true])).toBeNull()
  })
})
