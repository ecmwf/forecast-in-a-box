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
 * Hold-Z magnifier for any compare map (single-map modes and each
 * side-by-side panel): a circular loupe near the cursor (above when
 * there is headroom, else below, clamped into the map) drawn from the
 * map's composited canvas — raster zoom, honest about pixels, and the
 * active mode's clipping is baked in. While held, the cursor area shows
 * a dashed outline of exactly what the loupe magnifies, plus a
 * crosshair through the loupe centre.
 */

import { useEffect, useRef, useState } from 'react'
import { drawCompositedViewport } from '../map-export'
import type { RefObject } from 'react'

const DEFAULT_LOUPE_SIZE_PX = 180
const LOUPE_ZOOM = 2
const LOUPE_GAP_PX = 32

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi))

export function LoupeOverlay({
  containerRef,
  mirror = null,
  sizePx = DEFAULT_LOUPE_SIZE_PX,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  /** Sibling panel's cursor fraction — mirrors the loupe onto this map
   *  while the pointer is over the other side-by-side panel. */
  mirror?: { x: number; y: number } | null
  /** Loupe diameter in CSS pixels. */
  sizePx?: number
}) {
  const [active, setActive] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceSize = sizePx / LOUPE_ZOOM

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || e.repeat) return
      const target = e.target as HTMLElement | null
      // Block only text entry — sliders/switches (range/checkbox) must not disable the loupe.
      if (
        target?.closest(
          'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable="true"]',
        )
      )
        return
      setActive(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'z') setActive(false)
    }
    const blur = () => setActive(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    if (!active) setPos(null)
  }, [active])

  const onShieldMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  // Local cursor wins; else mirror the sibling panel's cursor fraction
  // (same geographic point — both panels share the view).
  const box = containerRef.current
  const drawPos =
    pos ??
    (mirror && box
      ? { x: mirror.x * box.clientWidth, y: mirror.y * box.clientHeight }
      : null)
  const drawX = drawPos?.x ?? null
  const drawY = drawPos?.y ?? null

  // The map root clips overflow, so a fixed above-cursor offset pushes
  // large loupes outside it. Float above the cursor while there is
  // headroom, flip below near the top, and clamp into the container.
  const half = sizePx / 2
  const loupeCenter =
    drawPos && box
      ? {
          x: clamp(drawPos.x, half, box.clientWidth - half),
          y: clamp(
            drawPos.y - LOUPE_GAP_PX - half >= half
              ? drawPos.y - LOUPE_GAP_PX - half
              : drawPos.y + LOUPE_GAP_PX + half,
            half,
            box.clientHeight - half,
          ),
        }
      : drawPos

  useEffect(() => {
    if (!active || drawX === null || drawY === null) return
    const container = containerRef.current
    const loupe = canvasRef.current
    if (!container || !loupe) return
    let raf = 0
    const draw = () => {
      const ctx = loupe.getContext('2d')
      if (ctx) {
        // The map is several stacked canvases (vector basemap, WMS image
        // group, vector overlays), each with its own CSS transform and
        // DOM-level opacity — composite them all, or the loupe shows the
        // wrong layers at the wrong place and darkness.
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, loupe.width, loupe.height)
        drawCompositedViewport(container, ctx, {
          originX: drawX - sourceSize / 2,
          originY: drawY - sourceSize / 2,
          scale: loupe.width / sourceSize,
        })
        // Crosshair through the magnified centre.
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(loupe.width / 2, 0)
        ctx.lineTo(loupe.width / 2, loupe.height)
        ctx.moveTo(0, loupe.height / 2)
        ctx.lineTo(loupe.width, loupe.height / 2)
        ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, drawX, drawY, sourceSize, containerRef])

  if (!active) return null
  return (
    <>
      {/* Shield with a crosshair cursor: while Z is held the pointer
          inspects instead of panning, and this layer owns the tracking
          (cursor styles are inert on pointer-events-none elements). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-20 cursor-crosshair"
        onPointerMove={onShieldMove}
        onPointerLeave={() => setPos(null)}
      />
      {drawPos && (
        <>
          {/* Exactly the region the loupe magnifies. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20 rounded-sm border border-dashed border-foreground/70 bg-foreground/5"
            style={{
              width: sourceSize,
              height: sourceSize,
              left: drawPos.x,
              top: drawPos.y,
              transform: 'translate(-50%, -50%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-30 overflow-hidden rounded-full border-2 border-background shadow-lg ring-1 ring-border"
            style={{
              width: sizePx,
              height: sizePx,
              left: (loupeCenter ?? drawPos).x,
              top: (loupeCenter ?? drawPos).y,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <canvas
              ref={canvasRef}
              width={sizePx * 2}
              height={sizePx * 2}
              className="h-full w-full"
            />
          </div>
        </>
      )}
    </>
  )
}
