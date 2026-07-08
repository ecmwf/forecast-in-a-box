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
 * Export the current comparison: editable title/description, then either
 * a PNG download (single capture, or both panels stacked for
 * side-by-side) or a print-ready report page (title, description, maps,
 * metadata, attribution) handed to the browser's print-to-PDF — no PDF
 * library needed, and typography stays native.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CaptureResult } from './types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'

const log = createLogger('CompareExportDialog')

export interface CompareExportMeta {
  labelA: string
  labelB: string
  modeLabel: string
  validTime: string | null
}

export function CompareExportDialog({
  open,
  onOpenChange,
  capture,
  meta,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Registered by the active map component; null while unavailable. */
  capture: (() => Promise<Array<CaptureResult>>) | null
  meta: CompareExportMeta
}) {
  const { t } = useTranslation('compare')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const effectiveTitle = title.trim() || `${meta.labelA} vs ${meta.labelB}`

  const withCaptures = async (
    use: (captures: Array<CaptureResult>) => void,
  ) => {
    if (!capture) return
    try {
      const captures = await capture()
      if (captures.length === 0) {
        showToast.error(t('export.failed'))
        return
      }
      use(captures)
    } catch (err) {
      log.error('Comparison export failed', { error: err })
      showToast.error(t('export.failed'))
    }
  }

  const downloadPng = () =>
    withCaptures((captures) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      captures.forEach((c, i) => {
        const a = document.createElement('a')
        a.href = c.dataUrl
        a.download = `compare-${stamp}${captures.length > 1 ? `-${i + 1}` : ''}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
      })
    })

  const printReport = () =>
    withCaptures((captures) => {
      // Blob URL instead of document.write; all interpolations are
      // escaped. The report document inherits our CSP (script-src
      // 'self'), so printing is triggered from the opener, not inline.
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const images = captures
        .map(
          (c) => `
            <figure>
              <img src="${c.dataUrl}" alt="${esc(c.label)}" />
              <figcaption>${esc(c.label)}</figcaption>
            </figure>`,
        )
        .join('\n')
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(effectiveTitle)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
  p.desc { margin: 0 0 1rem; max-width: 70ch; }
  .meta { font-size: 0.8rem; color: #555; margin-bottom: 1.25rem; }
  figure { margin: 0 0 1rem; break-inside: avoid; }
  img { max-width: 100%; border: 1px solid #ddd; }
  figcaption { font-size: 0.8rem; color: #555; margin-top: 0.25rem; }
  @media print { body { margin: 0.5cm; } }
</style></head><body>
  <h1>${esc(effectiveTitle)}</h1>
  ${description.trim() ? `<p class="desc">${esc(description.trim())}</p>` : ''}
  <div class="meta">
    A: ${esc(meta.labelA)} · B: ${esc(meta.labelB)} · ${esc(meta.modeLabel)}
    ${meta.validTime ? ` · ${esc(meta.validTime)}` : ''}
    · Forecast-in-a-Box
  </div>
  ${images}
</body></html>`
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      const w = window.open(url, '_blank')
      if (!w) {
        URL.revokeObjectURL(url)
        showToast.error(t('export.popupBlocked'))
        return
      }
      w.addEventListener('load', () => {
        URL.revokeObjectURL(url)
        setTimeout(() => w.print(), 200)
      })
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('export.title')}</DialogTitle>
          <DialogDescription>{t('export.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t('export.titleLabel')}
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${meta.labelA} vs ${meta.labelB}`}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t('export.descriptionLabel')}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('export.descriptionPlaceholder')}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!capture}
            onClick={() => void downloadPng()}
          >
            {t('export.png')}
          </Button>
          <Button disabled={!capture} onClick={() => void printReport()}>
            {t('export.print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
