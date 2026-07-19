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
 * Export the current comparison as PNG: editable title, then a
 * self-describing capture per map — baked title/valid-time bar and the
 * relevant legends below (two files in side-by-side). A print/PDF report
 * existed briefly but browser print output wasn't worth its surface —
 * PNG-only by user decision (2026-07-09).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { composeCaptures } from './export-pipeline'
import type { ExportLegendSpec } from './export-pipeline'
import type { MapAnnotation } from './annotations'
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
  /** null when exporting a solo view. */
  labelB: string | null
}

export function CompareExportDialog({
  open,
  onOpenChange,
  capture,
  legends,
  annotations,
  meta,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Registered by the active map component; null while unavailable. */
  capture: (() => Promise<Array<CaptureResult>>) | null
  /** Active layers' legend images, baked into PNGs and the report. */
  legends: ReadonlyArray<ExportLegendSpec>
  /** Findings pinned to the map — texts baked as a numbered strip. */
  annotations: ReadonlyArray<MapAnnotation>
  meta: CompareExportMeta
}) {
  const { t } = useTranslation('compare')
  const [title, setTitle] = useState('')

  const downloadPng = async () => {
    if (!capture) return
    try {
      const canvases = await composeCaptures({
        capture,
        legends,
        annotations,
        title,
      })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      canvases.forEach((composed, i) => {
        const a = document.createElement('a')
        a.href = composed.toDataURL('image/png')
        a.download = `compare-${stamp}${canvases.length > 1 ? `-${i + 1}` : ''}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
      })
    } catch (err) {
      log.error('Comparison export failed', { error: err })
      showToast.error(t('export.failed'))
    }
  }

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
              placeholder={
                meta.labelB === null
                  ? meta.labelA
                  : `${meta.labelA} vs ${meta.labelB}`
              }
            />
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!capture} onClick={() => void downloadPng()}>
            {t('export.png')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
