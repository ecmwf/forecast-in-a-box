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
 * side-by-side panel): a circular loupe above the cursor drawn from the
 * map's composited canvas — raster zoom, honest about pixels, and the
 * active mode's clipping is baked in. While held, the cursor area shows
 * a dashed outline of exactly what the loupe magnifies, plus a
 * crosshair through the loupe centre.
 */

import { useEffect, useRef, useState } from 'react'
import { drawCompositedViewport } from '../map-export'
import type { RefObject } from 'react'

const LOUPE_SIZE_PX = 180
const LOUPE_ZOOM = 2
const SOURCE_SIZE_PX = LOUPE_SIZE_PX / LOUPE_ZOOM

export function LoupeOverlay({
  containerRef,
  mirror = null,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  /** Sibling panel's cursor fraction — mirrors the loupe onto this map
   *  while the pointer is over the other side-by-side panel. */
  mirror?: { x: number; y: number } | null
}) {
  const [active, setActive] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && target.closest('input, textarea, select')) return
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
          originX: drawX - SOURCE_SIZE_PX / 2,
          originY: drawY - SOURCE_SIZE_PX / 2,
          scale: loupe.width / SOURCE_SIZE_PX,
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
  }, [active, drawX, drawY, containerRef])

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
              width: SOURCE_SIZE_PX,
              height: SOURCE_SIZE_PX,
              left: drawPos.x,
              top: drawPos.y,
              transform: 'translate(-50%, -50%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-30 overflow-hidden rounded-full border-2 border-background shadow-lg ring-1 ring-border"
            style={{
              width: LOUPE_SIZE_PX,
              height: LOUPE_SIZE_PX,
              left: drawPos.x,
              top: drawPos.y,
              transform: 'translate(-50%, -118%)',
            }}
          >
            <canvas
              ref={canvasRef}
              width={LOUPE_SIZE_PX * 2}
              height={LOUPE_SIZE_PX * 2}
              className="h-full w-full"
            />
          </div>
        </>
      )}
    </>
  )
}
