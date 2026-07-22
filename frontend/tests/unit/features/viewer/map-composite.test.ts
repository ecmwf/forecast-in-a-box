/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { drawCompositedViewport } from '@/features/viewer/map-export'

/** An .ol-layer canvas child like OL's composite renderer produces. */
function addLayerCanvas(
  container: HTMLElement,
  opts: {
    backing: number
    css: number
    fill: string
    transform?: string
    opacity?: string
  },
): void {
  const layerDiv = document.createElement('div')
  layerDiv.className = 'ol-layer'
  if (opts.opacity) layerDiv.style.opacity = opts.opacity
  const canvas = document.createElement('canvas')
  canvas.width = opts.backing
  canvas.height = opts.backing
  canvas.style.width = `${opts.css}px`
  canvas.style.height = `${opts.css}px`
  if (opts.transform) canvas.style.transform = opts.transform
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = opts.fill
  ctx.fillRect(0, 0, opts.backing, opts.backing)
  layerDiv.appendChild(canvas)
  container.appendChild(layerDiv)
}

function compositePixel(
  container: HTMLElement,
  atCssX: number,
  atCssY: number,
): Uint8ClampedArray {
  const out = document.createElement('canvas')
  out.width = 100
  out.height = 100
  const ctx = out.getContext('2d')!
  drawCompositedViewport(container, ctx, { originX: 0, originY: 0, scale: 1 })
  return ctx.getImageData(atCssX, atCssY, 1, 1).data
}

describe('drawCompositedViewport', () => {
  let container: HTMLElement

  afterEach(() => {
    container.remove()
  })

  function mount(): HTMLElement {
    container = document.createElement('div')
    container.style.cssText = 'position:relative;width:100px;height:100px'
    document.body.appendChild(container)
    return container
  }

  it('maps DPR-backed canvases through their client size', () => {
    const c = mount()
    // 200px backing displayed at 100px CSS (a 2× display) — a red pixel
    // at backing (150,150) must land at CSS (75,75), not (150,150).
    addLayerCanvas(c, { backing: 200, css: 100, fill: 'rgb(255,0,0)' })
    const px = compositePixel(c, 75, 75)
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0])
  })

  it('applies the CSS matrix and stacks multiple canvases', () => {
    const c = mount()
    addLayerCanvas(c, { backing: 100, css: 100, fill: 'rgb(0,0,255)' })
    // Second canvas translated 50px right via CSS matrix: its green must
    // cover the right half only.
    addLayerCanvas(c, {
      backing: 100,
      css: 100,
      fill: 'rgb(0,128,0)',
      transform: 'matrix(1, 0, 0, 1, 50, 0)',
    })
    const left = compositePixel(c, 10, 50)
    const right = compositePixel(c, 90, 50)
    expect([left[0], left[1], left[2]]).toEqual([0, 0, 255])
    expect([right[0], right[1], right[2]]).toEqual([0, 128, 0])
  })

  it('honors DOM-level layer opacity', () => {
    const c = mount()
    addLayerCanvas(c, { backing: 100, css: 100, fill: 'rgb(255,255,255)' })
    addLayerCanvas(c, {
      backing: 100,
      css: 100,
      fill: 'rgb(0,0,0)',
      opacity: '0.5',
    })
    const px = compositePixel(c, 50, 50)
    // Half-opaque black over white ≈ mid grey.
    expect(px[0]).toBeGreaterThan(100)
    expect(px[0]).toBeLessThan(155)
  })
})
