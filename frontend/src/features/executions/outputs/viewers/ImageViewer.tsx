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

interface Point {
  x: number
  y: number
}

interface Marquee {
  start: Point
  end: Point
}

export default function ImageViewer({
  item,
  adapter,
  onClose,
  onPrev,
  onNext,
  navIndex,
}: ViewerProps) {
  const { t } = useTranslation('executions')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const dragRef = useRef<Point | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!blob) return
    const tagged = new Blob([blob], { type: renderMime })
    const createdUrl = URL.createObjectURL(tagged)
    setBlobUrl(createdUrl)
    return () => URL.revokeObjectURL(createdUrl)
  }, [blob, renderMime])

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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const direction = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    setScale((s) => clamp(s * direction, MIN_SCALE, MAX_SCALE))
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
    },
    [offset],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (marquee) {
        setMarquee({ start: marquee.start, end: stageLocal(e) })
        return
      }
      if (!dragRef.current) return
      setOffset({
        x: e.clientX - dragRef.current.x,
        y: e.clientY - dragRef.current.y,
      })
    },
    [marquee],
  )

  const finalizeMarquee = useCallback(() => {
    if (!marquee || !stageRef.current) {
      dragRef.current = null
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
    setScale(nextScale)
    setOffset({
      x: ratio * (offset.x + (vcx - mcx)),
      y: ratio * (offset.y + (vcy - mcy)),
    })
    setMarquee(null)
  }, [marquee, offset, scale])

  const handleMouseUp = useCallback(() => {
    if (marquee) {
      finalizeMarquee()
      return
    }
    dragRef.current = null
  }, [marquee, finalizeMarquee])

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])
  const zoomIn = useCallback(
    () => setScale((s) => clamp(s * ZOOM_STEP, MIN_SCALE, MAX_SCALE)),
    [],
  )
  const zoomOut = useCallback(
    () => setScale((s) => clamp(s / ZOOM_STEP, MIN_SCALE, MAX_SCALE)),
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
            <span className="min-w-10 text-center font-mono text-xs tabular-nums">
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
          <span className="min-w-12 text-center font-mono text-xs tabular-nums">
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
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {blobUrl && (
          <img
            src={blobUrl}
            alt={item.originalBlock}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-1/2 left-1/2 max-h-[85vh] max-w-[85vw] origin-center object-contain select-none [image-rendering:pixelated]"
            style={{
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: marquee
                ? 'crosshair'
                : dragRef.current
                  ? 'grabbing'
                  : 'grab',
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

        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/40 px-2 py-1 text-xs text-white/70">
          {t('outputs.viewer.zoomHint')}
        </div>
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
