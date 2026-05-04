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
 * First-page PDF render for the grid card. Uses an IntersectionObserver so
 * pdfjs-dist only loads when the card actually scrolls into view.
 */

import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThumbnailProps } from '../types'
import { getJobResult } from '@/api/endpoints/job'
import { createLogger } from '@/lib/logger'

const log = createLogger('PdfThumbnail')

export function PdfThumbnail({ item }: ThumbnailProps) {
  const { t } = useTranslation('executions')
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [rendered, setRendered] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldRender(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldRender || !item.isAvailable) return
    const state: { cancelled: boolean } = { cancelled: false }
    void (async () => {
      try {
        const { pdfjs } = await import('./pdfjs')
        const { blob } = await getJobResult(item.jobId, item.taskId)

        if (state.cancelled) return
        const buf = await blob.arrayBuffer()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (state.cancelled) return
        const doc = await pdfjs.getDocument({ data: buf }).promise
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (state.cancelled) return
        setPageCount(doc.numPages)
        const page = await doc.getPage(1)
        const canvas = canvasRef.current
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (state.cancelled || !canvas) return
        const viewport = page.getViewport({ scale: 1 })
        const targetWidth = canvas.parentElement?.clientWidth ?? 240
        const scale = targetWidth / viewport.width
        const scaled = page.getViewport({ scale })
        canvas.width = scaled.width
        canvas.height = scaled.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvasContext: ctx, viewport: scaled, canvas })
          .promise
      } catch (err) {
        log.error('Failed to render PDF thumbnail', {
          taskId: item.taskId,
          error: err,
        })
      } finally {
        if (!state.cancelled) setRendered(true)
      }
    })()
    return () => {
      state.cancelled = true
    }
  }, [shouldRender, item.isAvailable, item.jobId, item.taskId])

  return (
    <div
      ref={ref}
      className="relative flex aspect-video items-center justify-center overflow-hidden rounded bg-muted"
    >
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
      {!rendered && (
        <FileText className="absolute h-8 w-8 text-muted-foreground" />
      )}
      {pageCount !== null && (
        <span className="absolute right-1 bottom-1 rounded bg-black/50 px-1.5 py-0.5 font-mono text-xs text-white">
          {t('outputs.viewer.pdfPageCount', { count: pageCount })}
        </span>
      )}
    </div>
  )
}
