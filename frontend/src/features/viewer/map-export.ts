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
 * PNG export for the WMS viewers. An OL map is SEVERAL stacked canvases —
 * consecutive default-class layers share one, but the vector basemap,
 * vector overlays (measure sketches, GeoJSON) and any interleaving split
 * the stack — each positioned by its own CSS transform, with layer
 * opacity applied on the DOM element rather than baked into pixels.
 * `drawCompositedViewport` walks them all (the official OL export
 * recipe), so exports and the loupe match the screen exactly. With
 * `crossOrigin: 'anonymous'` on the sources the canvases are untainted.
 */

import { formatStep } from './format'
import { rebaseLensUrl } from './wms-capabilities'
import type OlMap from 'ol/Map'
import type { ParsedLayer } from './wms-capabilities'

const CANVAS_MATRIX_RE = /^matrix\(([^)]*)\)$/

/**
 * Composite every OL layer canvas under `container` into `ctx`, honoring
 * each canvas's CSS transform (canvas px → CSS px), its layer's DOM
 * opacity, and any layer background. The viewport region starting at
 * (originX, originY) CSS px is drawn scaled by `scale` (destination px
 * per CSS px). Resets ctx transform/alpha when done.
 */
export function drawCompositedViewport(
  container: HTMLElement,
  ctx: CanvasRenderingContext2D,
  opts: { originX: number; originY: number; scale: number },
): void {
  const { originX, originY, scale } = opts
  const canvases = container.querySelectorAll<HTMLCanvasElement>(
    '.ol-layer canvas, canvas.ol-layer',
  )
  canvases.forEach((canvas) => {
    if (canvas.width === 0) return
    const parent = canvas.parentElement
    const opacityStr = parent?.style.opacity || canvas.style.opacity
    const alpha = opacityStr ? Number(opacityStr) : 1
    if (alpha === 0) return
    ctx.globalAlpha = Number.isFinite(alpha) ? alpha : 1

    const bg = parent?.style.backgroundColor
    if (bg) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.restore()
    }

    // Canvas px → CSS px: the CSS matrix when set, else the client/backing
    // ratio (identity transform, DPR-scaled backing store).
    let m: ReadonlyArray<number> = [1, 0, 0, 1, 0, 0]
    const match = CANVAS_MATRIX_RE.exec(canvas.style.transform)
    if (match) {
      const parts = match[1].split(',').map(Number)
      if (parts.length === 6 && parts.every(Number.isFinite)) m = parts
    } else if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      m = [
        canvas.clientWidth / canvas.width,
        0,
        0,
        canvas.clientHeight / canvas.height,
        0,
        0,
      ]
    }
    ctx.setTransform(
      scale * m[0],
      scale * m[1],
      scale * m[2],
      scale * m[3],
      scale * (m[4] - originX),
      scale * (m[5] - originY),
    )
    ctx.drawImage(canvas, 0, 0)
  })
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
}

/**
 * Full-viewport composite of a rendered OL map onto a fresh canvas at
 * device-pixel resolution, on a white ground. Null when the container has
 * no size yet.
 */
export function compositeMapToCanvas(
  container: HTMLElement,
): HTMLCanvasElement | null {
  const width = container.clientWidth
  const height = container.clientHeight
  if (width === 0 || height === 0) return null
  const dpr = window.devicePixelRatio || 1
  const out = document.createElement('canvas')
  out.width = Math.round(width * dpr)
  out.height = Math.round(height * dpr)
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  drawCompositedViewport(container, ctx, { originX: 0, originY: 0, scale: dpr })
  return out
}

/** Join canvases left-to-right on a white ground (side-by-side copy). */
export function joinCanvasesHorizontally(
  canvases: ReadonlyArray<HTMLCanvasElement>,
): HTMLCanvasElement | null {
  if (canvases.length === 0) return null
  if (canvases.length === 1) return canvases[0]
  const gap = 16
  const width =
    canvases.reduce((w, c) => w + c.width, 0) + gap * (canvases.length - 1)
  const height = Math.max(...canvases.map((c) => c.height))
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  let x = 0
  for (const canvas of canvases) {
    ctx.drawImage(canvas, x, 0)
    x += canvas.width + gap
  }
  return out
}

export function canvasToPngBlob(
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

export interface LegendExportItem {
  title: string
  image: HTMLImageElement
}

/**
 * Compose a final export canvas from a raw map capture: optional baked
 * title bar (title + preformatted time) and a legend strip below the
 * map. Shared by the embedded viewer's PNG export and the compare
 * captures.
 */
export interface ExportNote {
  number: number
  text: string
}

export function composeExportCanvas(
  mapCanvas: HTMLCanvasElement,
  opts: {
    titles: ReadonlyArray<string>
    /** Already display-formatted time text (null = omitted). */
    timeText: string | null
    titleBarEnabled: boolean
    legendItems: ReadonlyArray<LegendExportItem>
    /** Annotation texts, baked as a numbered strip below the legends. */
    notes?: ReadonlyArray<ExportNote>
  },
): HTMLCanvasElement | null {
  const { titles, timeText, titleBarEnabled, legendItems, notes = [] } = opts
  const dpr = window.devicePixelRatio || 1
  const legendHeight =
    legendItems.length > 0
      ? measureLegendStrip(legendItems, mapCanvas.width, dpr)
      : 0
  const probe = document.createElement('canvas').getContext('2d')
  const notesHeight =
    notes.length > 0 && probe
      ? measureNotesStrip(probe, notes, mapCanvas.width, dpr)
      : 0
  const out = document.createElement('canvas')
  out.width = mapCanvas.width
  out.height = mapCanvas.height + legendHeight + notesHeight
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(mapCanvas, 0, 0)
  if (titleBarEnabled && titles.length > 0) {
    drawTitleBar(ctx, out.width, titles, timeText)
  }
  if (legendHeight > 0) {
    drawLegendStrip(ctx, legendItems, out.width, mapCanvas.height, dpr)
  }
  if (notesHeight > 0) {
    drawNotesStrip(ctx, notes, out.width, mapCanvas.height + legendHeight, dpr)
  }
  return out
}

const NOTES_PAD = 16
const NOTES_FONT_PX = 13
const NOTES_LINE_HEIGHT = 1.45
const NOTES_NUMBER_COL = 26

function notesFont(dpr: number): string {
  return `${NOTES_FONT_PX * dpr}px system-ui, -apple-system, "Segoe UI", sans-serif`
}

/** Word-wrap one note's text to the strip's inner width. */
function wrapNoteLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): Array<string> {
  const lines: Array<string> = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

function measureNotesStrip(
  ctx: CanvasRenderingContext2D,
  notes: ReadonlyArray<ExportNote>,
  canvasWidth: number,
  dpr: number,
): number {
  ctx.font = notesFont(dpr)
  const pad = NOTES_PAD * dpr
  const innerWidth = canvasWidth - pad * 2 - NOTES_NUMBER_COL * dpr
  const lineHeight = NOTES_FONT_PX * NOTES_LINE_HEIGHT * dpr
  let lines = 0
  for (const note of notes) {
    lines += wrapNoteLines(ctx, note.text, innerWidth).length
  }
  return pad * 2 + lines * lineHeight + (notes.length - 1) * lineHeight * 0.35
}

function drawNotesStrip(
  ctx: CanvasRenderingContext2D,
  notes: ReadonlyArray<ExportNote>,
  canvasWidth: number,
  yOffset: number,
  dpr: number,
): void {
  const pad = NOTES_PAD * dpr
  const numberCol = NOTES_NUMBER_COL * dpr
  const innerWidth = canvasWidth - pad * 2 - numberCol
  const lineHeight = NOTES_FONT_PX * NOTES_LINE_HEIGHT * dpr
  const totalHeight = measureNotesStrip(ctx, notes, canvasWidth, dpr)

  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)'
  ctx.fillRect(0, yOffset, canvasWidth, totalHeight)
  ctx.font = notesFont(dpr)
  ctx.textBaseline = 'top'

  let y = yOffset + pad
  notes.forEach((note, i) => {
    if (i > 0) y += lineHeight * 0.35
    ctx.fillStyle = '#111'
    ctx.textAlign = 'right'
    ctx.fillText(`${note.number}.`, pad + numberCol - 8 * dpr, y)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#333'
    for (const line of wrapNoteLines(ctx, note.text, innerWidth)) {
      ctx.fillText(line, pad + numberCol, y)
      y += lineHeight
    }
  })
  ctx.restore()
}

/** Load one legend image (anonymous CORS); null on failure. */
export function loadLegendImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
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
      const mapCanvas = compositeMapToCanvas(target)
      if (!mapCanvas) return resolve(null)
      const out = composeExportCanvas(mapCanvas, {
        titles,
        timeText: activeTime ? formatStep(activeTime) : null,
        titleBarEnabled,
        legendItems,
      })
      if (!out) return resolve(null)
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
  time: string | null,
): void {
  const dpr = window.devicePixelRatio || 1
  const fontPx = 14 * dpr
  const padX = 16 * dpr
  const padY = 8 * dpr
  const top = 16 * dpr
  const radius = 8 * dpr
  const titleText = titles.join(' · ')
  const timeText = time ?? ''

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
