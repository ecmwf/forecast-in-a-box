/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  Maximize2,
  SkipBack,
  SkipForward,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { downloadAction } from '../actions/download'
import { useJobResultBlob } from '../useJobResult'
import { kbdBadge, viewerHeaderBtn } from './viewerHeaderBtn'
import type { ViewerProps } from '../types'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const MIN_SCALE = 0.25
const MAX_SCALE = 32
const ZOOM_STEP = 1.2
const MIN_MARQUEE_PX = 12
// Zoom per wheel px; pinch sends much smaller deltas.
const WHEEL_ZOOM_RATE = 0.002
const PINCH_ZOOM_RATE = 0.01
// Caps zoom per wheel event.
const MAX_WHEEL_DELTA = 100
// Screen px per source px before rendering turns pixelated.
const PIXELATED_FROM = 2

interface Point {
  x: number
  y: number
}

interface Marquee {
  start: Point
  end: Point
}

interface View {
  scale: number
  offset: Point
}

const INITIAL_VIEW: View = { scale: 1, offset: { x: 0, y: 0 } }

export default function ImageViewer({
  item,
  adapter,
  onClose,
  onPrev,
  onNext,
  navIndex,
}: ViewerProps) {
  const { t } = useTranslation('executions')
  const [shownUrl, setShownUrl] = useState<string | null>(null)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [dragging, setDragging] = useState(false)
  // Displayed px per source px at scale 1.
  const [fitRatio, setFitRatio] = useState(1)
  const dragRef = useRef<Point | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const shownUrlRef = useRef<string | null>(null)
  const { scale, offset } = view

  // SVG needs an explicit mime tag — `<img>` strict-checks it where it
  // sniffs raster. For raster, trust item.mimeType when the adapter
  // advertises it, else fall back to the adapter's primary mime.
  const renderMime =
    adapter.id === 'image-vector'
      ? 'image/svg+xml'
      : adapter.mimeTypes.includes(item.mimeType)
        ? item.mimeType
        : (adapter.mimeTypes[0] ?? 'image/png')

  // Shared cache — the grid thumbnail for this same output reuses this blob.
  const { data, error } = useJobResultBlob(item.jobId, item.taskId)
  const blob = data?.blob

  // Swap images only once the next one is decoded.
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(new Blob([blob], { type: renderMime }))
    const probe = new Image()
    probe.src = url
    let cancelled = false
    void probe
      .decode()
      .catch(() => undefined)
      .then(() => {
        // Revoke after decode; earlier logs a failed load.
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        if (shownUrlRef.current) URL.revokeObjectURL(shownUrlRef.current)
        shownUrlRef.current = url
        setShownUrl(url)
        setView(INITIAL_VIEW)
        setMarquee(null)
      })
    return () => {
      cancelled = true
    }
  }, [blob, renderMime])

  useEffect(
    () => () => {
      if (shownUrlRef.current) URL.revokeObjectURL(shownUrlRef.current)
    },
    [],
  )

  useEffect(() => {
    if (error) showToast.error(error.message)
  }, [error])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Native listener: React's onWheel is passive.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rate = e.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE
      const delta = clamp(wheelPixels(e), -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setView((v) =>
        zoomAt(v, Math.exp(-delta * rate), {
          x: e.clientX - rect.left - rect.width / 2,
          y: e.clientY - rect.top - rect.height / 2,
        }),
      )
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  const stageLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Shift starts a marquee zoom; otherwise begin pan.
      if (e.shiftKey) {
        const p = stageLocal(e)
        setMarquee({ start: p, end: p })
        return
      }
      dragRef.current = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      }
      setDragging(true)
    },
    [offset],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (marquee) {
        setMarquee({ start: marquee.start, end: stageLocal(e) })
        return
      }
      const drag = dragRef.current
      if (!drag) return
      setView((v) => ({
        ...v,
        offset: { x: e.clientX - drag.x, y: e.clientY - drag.y },
      }))
    },
    [marquee],
  )

  const finalizeMarquee = useCallback(() => {
    if (!marquee || !stageRef.current) {
      setMarquee(null)
      return
    }
    const stage = stageRef.current.getBoundingClientRect()
    const x1 = Math.min(marquee.start.x, marquee.end.x)
    const y1 = Math.min(marquee.start.y, marquee.end.y)
    const x2 = Math.max(marquee.start.x, marquee.end.x)
    const y2 = Math.max(marquee.start.y, marquee.end.y)
    const rw = x2 - x1
    const rh = y2 - y1

    // Treat tiny rects as a click — discard.
    if (rw < MIN_MARQUEE_PX || rh < MIN_MARQUEE_PX) {
      setMarquee(null)
      return
    }

    // Stage center in local coords.
    const vcx = stage.width / 2
    const vcy = stage.height / 2
    // Marquee center in local coords.
    const mcx = (x1 + x2) / 2
    const mcy = (y1 + y2) / 2

    // Pick the limiting axis so the whole rect fits.
    const factor = Math.min(stage.width / rw, stage.height / rh)
    const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
    const ratio = nextScale / scale

    // The image is positioned at the stage center plus `offset`, scaled.
    // Solve for the new offset that puts the marquee center at stage center.
    setView({
      scale: nextScale,
      offset: {
        x: ratio * (offset.x + (vcx - mcx)),
        y: ratio * (offset.y + (vcy - mcy)),
      },
    })
    setMarquee(null)
  }, [marquee, offset, scale])

  const handleMouseUp = useCallback(() => {
    if (marquee) {
      finalizeMarquee()
      return
    }
    dragRef.current = null
    setDragging(false)
  }, [marquee, finalizeMarquee])

  const reset = useCallback(() => setView(INITIAL_VIEW), [])
  // Buttons zoom about the stage center.
  const zoomIn = useCallback(
    () => setView((v) => zoomAt(v, ZOOM_STEP, { x: 0, y: 0 })),
    [],
  )
  const zoomOut = useCallback(
    () => setView((v) => zoomAt(v, 1 / ZOOM_STEP, { x: 0, y: 0 })),
    [],
  )

  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.start.x, marquee.end.x),
        top: Math.min(marquee.start.y, marquee.end.y),
        width: Math.abs(marquee.end.x - marquee.start.x),
        height: Math.abs(marquee.end.y - marquee.start.y),
      }
    : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black/85"
      onClick={(e) => {
        // Close on direct backdrop clicks; children stop propagation.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <header
        className="relative flex items-center gap-4 border-b border-white/10 px-4 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate font-mono text-sm text-white/80">
          {item.originalBlock}
        </span>
        {navIndex && (
          <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
            <button
              type="button"
              aria-label={t('outputs.viewer.previousOutput')}
              className={cn(
                viewerHeaderBtn,
                'pointer-events-auto w-auto gap-1 px-1.5',
              )}
              onClick={onPrev}
              disabled={!onPrev}
            >
              <SkipBack className="h-4 w-4" />
              <kbd className={kbdBadge}>←</kbd>
            </button>
            <span className="min-w-10 text-center font-mono text-sm tabular-nums">
              {navIndex.current} / {navIndex.total}
            </span>
            <button
              type="button"
              aria-label={t('outputs.viewer.nextOutput')}
              className={cn(
                viewerHeaderBtn,
                'pointer-events-auto w-auto gap-1 px-1.5',
              )}
              onClick={onNext}
              disabled={!onNext}
            >
              <kbd className={kbdBadge}>→</kbd>
              <SkipForward className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={t('outputs.viewer.zoomOut')}
            className={viewerHeaderBtn}
            onClick={zoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center font-mono text-sm tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            aria-label={t('outputs.viewer.zoomIn')}
            className={viewerHeaderBtn}
            onClick={zoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t('outputs.viewer.resetZoom')}
            className={viewerHeaderBtn}
            onClick={reset}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="h-5 w-px bg-white/15" />
        <button
          type="button"
          aria-label={downloadAction.label(t)}
          className={viewerHeaderBtn}
          onClick={() =>
            void downloadAction.run(item, { resolvedAdapter: adapter })
          }
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t('outputs.viewer.close')}
          className={viewerHeaderBtn}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={stageRef}
        className="relative flex-1 overflow-hidden"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {shownUrl && (
          <img
            src={shownUrl}
            alt={item.originalBlock}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth > 0) {
                setFitRatio(img.clientWidth / img.naturalWidth)
              }
            }}
            className="absolute top-1/2 left-1/2 max-h-[85vh] max-w-[85vw] origin-center object-contain select-none"
            style={{
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              imageRendering:
                scale * fitRatio >= PIXELATED_FROM ? 'pixelated' : 'auto',
              cursor: marquee ? 'crosshair' : dragging ? 'grabbing' : 'grab',
            }}
          />
        )}

        {marqueeRect && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-white/90 bg-white/10"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/40 px-2 py-1 text-sm text-white/70">
          {t('outputs.viewer.zoomHint')}
        </div>
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Zooms by `factor` around `anchor` (relative to the stage center). */
function zoomAt(view: View, factor: number, anchor: Point): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
  const ratio = scale / view.scale
  return {
    scale,
    offset: {
      x: anchor.x - (anchor.x - view.offset.x) * ratio,
      y: anchor.y - (anchor.y - view.offset.y) * ratio,
    },
  }
}

/** Wheel delta in pixels, for any delta mode. */
function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * 16
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * 800
  return e.deltaY
}
