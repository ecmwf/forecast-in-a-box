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
import {
  canvasToPngBlob,
  composeExportCanvas,
  joinCanvasesHorizontally,
} from '@/features/viewer/map-export'

function mapCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 200
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgb(0,0,255)'
  ctx.fillRect(0, 0, 400, 200)
  return c
}

async function legendImage(): Promise<HTMLImageElement> {
  const c = document.createElement('canvas')
  c.width = 100
  c.height = 20
  c.getContext('2d')!.fillRect(0, 0, 100, 20)
  const img = new Image()
  img.src = c.toDataURL('image/png')
  await img.decode()
  return img
}

describe('composeExportCanvas', () => {
  it('keeps dimensions without legends and bakes a title bar', () => {
    const out = composeExportCanvas(mapCanvas(), {
      titles: ['A vs B'],
      timeText: '06 Jul 12:00Z',
      titleBarEnabled: true,
      legendItems: [],
    })!
    expect(out.width).toBe(400)
    expect(out.height).toBe(200)
    // The near-white pill over the blue ground lifts the red channel.
    const px = out.getContext('2d')!.getImageData(200, 24, 1, 1).data
    expect(px[0]).toBeGreaterThan(100)
  })

  it('extends the canvas downward for the legend strip', async () => {
    const out = composeExportCanvas(mapCanvas(), {
      titles: [],
      timeText: null,
      titleBarEnabled: false,
      legendItems: [{ title: '2 m temperature', image: await legendImage() }],
    })!
    expect(out.width).toBe(400)
    expect(out.height).toBeGreaterThan(200)
  })
})

describe('joinCanvasesHorizontally', () => {
  it('joins side by side with a gap, single canvas passes through', () => {
    const a = mapCanvas()
    expect(joinCanvasesHorizontally([a])).toBe(a)
    const joined = joinCanvasesHorizontally([mapCanvas(), mapCanvas()])!
    expect(joined.width).toBe(400 + 16 + 400)
    expect(joined.height).toBe(200)
    expect(joinCanvasesHorizontally([])).toBeNull()
  })
})

describe('canvasToPngBlob', () => {
  it('produces a PNG blob', async () => {
    const blob = await canvasToPngBlob(mapCanvas())
    expect(blob?.type).toBe('image/png')
  })
})
