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
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { downloadAction } from '../actions/download'
import { useJobResultBlob } from '../useJobResult'
import { pdfjs } from './pdfjs'
import { kbdBadge, viewerHeaderBtn } from './viewerHeaderBtn'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { ViewerProps } from '../types'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const log = createLogger('PdfViewer')
const MIN_SCALE = 0.5
const MAX_SCALE = 4

export default function PdfViewer({
  item,
  adapter,
  onClose,
  onPrev,
  onNext,
  navIndex,
  isPlaying,
  onTogglePlay,
}: ViewerProps) {
  const { t } = useTranslation('executions')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Shared cache — the grid thumbnail for this same output reuses this blob.
  const { data, error } = useJobResultBlob(item.jobId, item.taskId)
  const blob = data?.blob

  useEffect(() => {
    if (error) showToast.error(error.message)
  }, [error])

  useEffect(() => {
    if (!blob) return
    const state: { cancelled: boolean; loaded: PDFDocumentProxy | null } = {
      cancelled: false,
      loaded: null,
    }
    void (async () => {
      try {
        const buf = await blob.arrayBuffer()

        if (state.cancelled) return
        state.loaded = await pdfjs.getDocument({ data: buf }).promise
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (state.cancelled) {
          await state.loaded.destroy()
          return
        }
        setDoc(state.loaded)
      } catch (err) {
        log.error('Failed to load PDF', { taskId: item.taskId, error: err })
        showToast.error(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      state.cancelled = true
      if (state.loaded) {
        // Fire-and-forget destroy — pdfjs cleans worker resources.
        void state.loaded.destroy()
      }
    }
  }, [blob, item.taskId])

  useEffect(() => {
    if (!doc) return
    const state: {
      cancelled: boolean
      renderTask: ReturnType<PDFPageProxy['render']> | null
    } = { cancelled: false, renderTask: null }
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)

        if (state.cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * dpr })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width / dpr}px`
        canvas.style.height = `${viewport.height / dpr}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        state.renderTask = page.render({ canvasContext: ctx, viewport, canvas })
        await state.renderTask.promise
      } catch (err) {
        // Expected on .cancel() during rapid output nav — swallow it.
        if (
          (err as { name?: string } | null)?.name ===
          'RenderingCancelledException'
        ) {
          return
        }
        log.error('Failed to render PDF page', {
          taskId: item.taskId,
          pageNumber,
          error: err,
        })
        showToast.error(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      state.cancelled = true
      state.renderTask?.cancel()
    }
  }, [doc, pageNumber, scale, item.taskId])

  useEffect(() => {
    // Arrow keys belong to output nav (OutputsView); page nav uses buttons.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, s * 1.25)),
    [],
  )
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, s / 1.25)),
    [],
  )
  const totalPages = doc?.numPages ?? 0

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
            {onTogglePlay && (
              <button
                type="button"
                aria-label={
                  isPlaying
                    ? t('outputs.viewer.pauseAutoplay')
                    : t('outputs.viewer.playAutoplay')
                }
                className={cn(viewerHeaderBtn, 'pointer-events-auto ml-1')}
                onClick={onTogglePlay}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={t('outputs.viewer.previousPage')}
            className={viewerHeaderBtn}
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center font-mono text-xs tabular-nums">
            {t('outputs.viewer.pageOfTotal', {
              page: pageNumber,
              total: totalPages || '?',
            })}
          </span>
          <button
            type="button"
            aria-label={t('outputs.viewer.nextPage')}
            className={viewerHeaderBtn}
            onClick={() =>
              setPageNumber((p) => Math.min(totalPages || p, p + 1))
            }
            disabled={pageNumber >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="h-5 w-px bg-white/15" />
        <div className="flex items-center gap-1">
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
        className="flex-1 overflow-auto p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="flex justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <canvas
            ref={canvasRef}
            className="bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </div>
  )
}
