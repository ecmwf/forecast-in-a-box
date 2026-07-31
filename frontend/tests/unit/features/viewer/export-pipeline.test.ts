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
import type { CaptureResult } from '@/features/viewer/geo/types'
import { composeCaptures } from '@/features/viewer/geo/export-pipeline'

// 1×1 transparent PNG served without a network round-trip.
const LEGEND_OK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const LEGEND_BROKEN = 'data:image/png;base64,not-an-image'

function capture(slot: CaptureResult['slot']): CaptureResult {
  const canvas = document.createElement('canvas')
  canvas.width = 120
  canvas.height = 80
  canvas.getContext('2d')!.fillRect(0, 0, 120, 80)
  return {
    label: `capture ${slot ?? 'combined'}`,
    slot,
    canvas,
    timeLabel: null,
  }
}

describe('composeCaptures', () => {
  it('throws when the capture yields nothing', async () => {
    await expect(
      composeCaptures({
        capture: () => Promise.resolve([]),
        legends: [],
        annotations: [],
      }),
    ).rejects.toThrow('Nothing to capture')
  })

  it('bakes one fresh canvas per capture', async () => {
    const a = capture('a')
    const result = await composeCaptures({
      capture: () => Promise.resolve([a, capture('b')]),
      legends: [],
      annotations: [],
    })
    expect(result).toHaveLength(2)
    // The title bar overlays the map; without legends/notes the composed
    // canvas keeps the map's size but is a new canvas.
    expect(result[0]).not.toBe(a.canvas)
    expect(result[0].width).toBe(120)
    expect(result[0].height).toBe(80)
  })

  it('filters legends to the capture slot; combined view keeps all', async () => {
    const legends = [
      { slot: 'a' as const, title: 'Temp', url: LEGEND_OK },
      { slot: 'b' as const, title: 'Pressure', url: LEGEND_OK },
    ]
    const [aOnly] = await composeCaptures({
      capture: () => Promise.resolve([capture('a')]),
      legends: [legends[1]], // only B's legend — filtered out for slot a
      annotations: [],
    })
    const [aWithLegend] = await composeCaptures({
      capture: () => Promise.resolve([capture('a')]),
      legends: [legends[0]],
      annotations: [],
    })
    const [combined] = await composeCaptures({
      capture: () => Promise.resolve([capture(null)]),
      legends,
      annotations: [],
    })
    // A foreign-slot legend adds nothing; an own-slot legend adds a strip;
    // the combined view carries a strip too (its multi-column layout may
    // be shorter than a single-legend strip — no cross-comparison).
    expect(aOnly.height).toBe(80)
    expect(aWithLegend.height).toBeGreaterThan(aOnly.height)
    expect(combined.height).toBeGreaterThan(80)
  })

  it('drops legends that fail to load and still exports the map', async () => {
    const [withBroken] = await composeCaptures({
      capture: () => Promise.resolve([capture('a')]),
      legends: [{ slot: 'a', title: 'Broken', url: LEGEND_BROKEN }],
      annotations: [],
    })
    const [without] = await composeCaptures({
      capture: () => Promise.resolve([capture('a')]),
      legends: [],
      annotations: [],
    })
    expect(withBroken.height).toBe(without.height)
  })
})
