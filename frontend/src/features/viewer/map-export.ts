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
 * PNG export for the WMS viewers. OL composes all canvas-renderer layers
 * onto a single canvas in the map target (as long as no layer sets
 * `className` — see ol-layers.ts invariants). With `crossOrigin:
 * 'anonymous'` on the sources the canvas is not tainted, so toBlob()
 * returns a usable image. Title bar and pinned legends are composited onto
 * a fresh canvas so the export matches the on-screen viewer.
 */

import { formatStep } from './format'
import { rebaseLensUrl } from './wms-capabilities'
import type OlMap from 'ol/Map'
import type { ParsedLayer } from './wms-capabilities'

export interface LegendExportItem {
  title: string
  image: HTMLImageElement
}

export interface MapExportOptions {
  /** Active layer titles, stacking order, for the baked-in title bar. */
  titles: ReadonlyArray<string>
  /** Current WMS TIME value shown next to the titles (null = omitted). */
  activeTime: string | null
  /** Whether to bake the title bar into the export. */
  titleBarEnabled: boolean
  /** Pre-loaded pinned legend images, drawn as a strip below the map. */
  legendItems: ReadonlyArray<LegendExportItem>
}

/**
 * Render the map's next frame onto a fresh canvas together with the title
 * bar and legend strip. Resolves null when the map has no canvas (not
 * rendered yet) or the 2D context is unavailable.
 */
export async function exportMapPng(
  map: OlMap,
  opts: MapExportOptions,
): Promise<Blob | null> {
  const { titles, activeTime, titleBarEnabled, legendItems } = opts
  return new Promise<Blob | null>((resolve) => {
    map.once('rendercomplete', () => {
      const target = map.getTargetElement()
      const olCanvas = target.querySelector<HTMLCanvasElement>('canvas')
      if (!olCanvas) return resolve(null)
      // Composite OL canvas + (optionally) the title bar onto a fresh
      // canvas. We can't draw text directly onto OL's canvas — it gets
      // overwritten on the next render — and we also want the export to
      // be at the same intrinsic dimensions as the viewer. If any pinned
      // legends are present, the canvas extends downward to fit them in
      // a balanced grid below the map.
      const dpr = window.devicePixelRatio || 1
      const stripHeight =
        legendItems.length > 0
          ? measureLegendStrip(legendItems, olCanvas.width, dpr)
          : 0
      const out = document.createElement('canvas')
      out.width = olCanvas.width
      out.height = olCanvas.height + stripHeight
      const ctx = out.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(olCanvas, 0, 0)
      if (titleBarEnabled && titles.length > 0) {
        drawTitleBar(ctx, out.width, titles, activeTime)
      }
      if (stripHeight > 0) {
        drawLegendStrip(ctx, legendItems, out.width, olCanvas.height, dpr)
      }
      out.toBlob((blob) => resolve(blob), 'image/png')
    })
    map.renderSync()
  })
}

/**
 * Pre-load pinned legend images (cross-origin, anonymous) so they're ready
 * to draw onto the export canvas — if the map render raced ahead we'd draw
 * an empty box. Failed loads are dropped silently.
 */
export async function loadLegendImages(
  layers: ReadonlyArray<ParsedLayer>,
  pinned: ReadonlySet<string>,
  baseUrl: string,
): Promise<ReadonlyArray<LegendExportItem>> {
  const items: Array<{ title: string; url: string }> = []
  for (const name of pinned) {
    const layer = layers.find((l) => l.name === name)
    const url = layer?.styles[0]?.legendUrl
    if (!layer || !url) continue
    items.push({ title: layer.title, url: rebaseLensUrl(url, baseUrl) })
  }
  const loaded = await Promise.all(
    items.map(
      (it) =>
        new Promise<LegendExportItem | null>((resolve) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve({ title: it.title, image: img })
          img.onerror = () => resolve(null)
          img.src = it.url
        }),
    ),
  )
  return loaded.filter((x): x is LegendExportItem => x !== null)
}

/**
 * Paint the on-screen title bar onto the export canvas. The OL canvas is at
 * device pixel ratio (so on a 2× display we get a 2×-scaled bitmap), and we
 * scale font / padding accordingly so the baked-in title visually matches
 * what's on screen rather than appearing tiny on retina exports.
 *
 * Layout: pill at top-centre, 16 dpr-px from the top edge. Single line; long
 * titles truncate with an ellipsis rather than squeezing.
 */
function drawTitleBar(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  titles: ReadonlyArray<string>,
  activeTime: string | null,
): void {
  const dpr = window.devicePixelRatio || 1
  const fontPx = 14 * dpr
  const padX = 16 * dpr
  const padY = 8 * dpr
  const top = 16 * dpr
  const radius = 8 * dpr
  const titleText = titles.join(' · ')
  const timeText = activeTime ? formatStep(activeTime) : ''

  ctx.save()
  ctx.font = `500 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textBaseline = 'middle'

  const sepWidth = timeText
    ? ctx.measureText('  ').width + 1 * dpr // small gap on either side of divider
    : 0
  const timeWidth = timeText ? ctx.measureText(timeText).width : 0
  const maxBoxWidth = canvasWidth - 40 * dpr
  const reservedForTime = timeText ? sepWidth + timeWidth : 0
  const titleAvail = maxBoxWidth - padX * 2 - reservedForTime
  const fitTitle = ellipsizeToWidth(ctx, titleText, titleAvail)
  const fitTitleWidth = ctx.measureText(fitTitle).width
  const innerWidth = fitTitleWidth + reservedForTime
  const boxWidth = Math.min(innerWidth + padX * 2, maxBoxWidth)
  const boxHeight = fontPx + padY * 2
  const boxX = Math.round((canvasWidth - boxWidth) / 2)
  const boxY = top
  const centerY = boxY + boxHeight / 2

  // Background pill
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
  ctx.lineWidth = 1 * dpr
  roundedRectPath(ctx, boxX, boxY, boxWidth, boxHeight, radius)
  ctx.fill()
  ctx.stroke()

  let cursorX = boxX + padX
  ctx.fillStyle = '#111'
  ctx.textAlign = 'left'
  ctx.fillText(fitTitle, cursorX, centerY)
  cursorX += fitTitleWidth

  if (timeText) {
    cursorX += sepWidth / 2
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.beginPath()
    ctx.moveTo(cursorX, boxY + padY)
    ctx.lineTo(cursorX, boxY + boxHeight - padY)
    ctx.stroke()
    cursorX += sepWidth / 2
    ctx.fillStyle = '#555'
    ctx.fillText(timeText, cursorX, centerY)
  }

  ctx.restore()
}

function ellipsizeToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo) + ellipsis
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

const LEGEND_STRIP_PAD = 16
const LEGEND_CARD_PAD = 10
const LEGEND_CARD_GAP = 8
const LEGEND_TITLE_PX = 13
const LEGEND_TITLE_GAP = 6
const LEGEND_IMAGE_MAX_H = 110

// Pick column count to mirror the visual grid logic in PinnedLegendsBar.
function legendCols(n: number): number {
  if (n === 1) return 1
  if (n === 2 || n === 4) return 2
  if (n === 3) return 3
  return 3
}

function measureLegendStrip(
  items: ReadonlyArray<LegendExportItem>,
  canvasWidth: number,
  dpr: number,
): number {
  const cols = legendCols(items.length)
  const rows = Math.ceil(items.length / cols)
  const pad = LEGEND_STRIP_PAD * dpr
  const cardPad = LEGEND_CARD_PAD * dpr
  const gap = LEGEND_CARD_GAP * dpr
  const titlePx = LEGEND_TITLE_PX * dpr
  const titleGap = LEGEND_TITLE_GAP * dpr
  const cardWidth = (canvasWidth - pad * 2 - gap * (cols - 1)) / cols
  // Each legend image is rendered preserving aspect ratio, scaled down to
  // fit the card width, with a hard max height. Take the largest among the
  // items as the row's height (so cards align).
  const innerWidth = cardWidth - cardPad * 2
  let imageH = 0
  for (const item of items) {
    const ar = item.image.height / Math.max(1, item.image.width)
    const h = Math.min(innerWidth * ar, LEGEND_IMAGE_MAX_H * dpr)
    if (h > imageH) imageH = h
  }
  const cardHeight = cardPad * 2 + titlePx + titleGap + imageH
  return pad * 2 + cardHeight * rows + gap * (rows - 1)
}

function drawLegendStrip(
  ctx: CanvasRenderingContext2D,
  items: ReadonlyArray<LegendExportItem>,
  canvasWidth: number,
  yOffset: number,
  dpr: number,
): void {
  const cols = legendCols(items.length)
  const pad = LEGEND_STRIP_PAD * dpr
  const cardPad = LEGEND_CARD_PAD * dpr
  const gap = LEGEND_CARD_GAP * dpr
  const titlePx = LEGEND_TITLE_PX * dpr
  const titleGap = LEGEND_TITLE_GAP * dpr
  const cardWidth = (canvasWidth - pad * 2 - gap * (cols - 1)) / cols
  const innerWidth = cardWidth - cardPad * 2
  let imageH = 0
  for (const item of items) {
    const ar = item.image.height / Math.max(1, item.image.width)
    const h = Math.min(innerWidth * ar, LEGEND_IMAGE_MAX_H * dpr)
    if (h > imageH) imageH = h
  }
  const cardHeight = cardPad * 2 + titlePx + titleGap + imageH
  const radius = 6 * dpr

  // Strip background — soft white with subtle border, matching the live UI
  // pinned-legends bar.
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)'
  ctx.fillRect(
    0,
    yOffset,
    canvasWidth,
    pad * 2 +
      cardHeight * Math.ceil(items.length / cols) +
      gap * (Math.ceil(items.length / cols) - 1),
  )

  ctx.font = `500 ${titlePx}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textBaseline = 'top'

  items.forEach((item, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = pad + col * (cardWidth + gap)
    const y = yOffset + pad + row * (cardHeight + gap)

    // Card outline
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.lineWidth = 1 * dpr
    roundedRectPath(ctx, x, y, cardWidth, cardHeight, radius)
    ctx.fill()
    ctx.stroke()

    // Title (ellipsised to card inner width)
    ctx.fillStyle = '#111'
    ctx.textAlign = 'left'
    const fitTitle = ellipsizeToWidth(ctx, item.title, innerWidth)
    ctx.fillText(fitTitle, x + cardPad, y + cardPad)

    // Image (preserve aspect ratio, centred horizontally)
    const ar = item.image.height / Math.max(1, item.image.width)
    const targetW = Math.min(innerWidth, (LEGEND_IMAGE_MAX_H * dpr) / ar)
    const targetH = targetW * ar
    const imgX = x + cardPad + (innerWidth - targetW) / 2
    const imgY = y + cardPad + titlePx + titleGap + (imageH - targetH) / 2
    ctx.drawImage(item.image, imgX, imgY, targetW, targetH)
  })

  ctx.restore()
}
