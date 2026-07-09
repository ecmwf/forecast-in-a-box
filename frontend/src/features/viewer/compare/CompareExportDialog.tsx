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
import { composeExportCanvas, loadLegendImage } from '../map-export'
import { annotationVisibleOn } from './annotations'
import type { MapAnnotation } from './annotations'
import type { ExportNote, LegendExportItem } from '../map-export'
import type { SourceSlot } from './layer-pairing'
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
}

export interface ExportLegendSpec {
  slot: SourceSlot
  title: string
  url: string
}

interface LoadedLegend extends LegendExportItem {
  slot: SourceSlot
}

/** Legends relevant to one capture: its own slot, or all for combined. */
function legendsFor(
  capture: CaptureResult,
  legends: ReadonlyArray<LoadedLegend>,
): Array<LoadedLegend> {
  return legends.filter((l) => capture.slot === null || l.slot === capture.slot)
}

/** Notes for one capture — the annotations its panel actually shows,
 *  keeping their global numbering. */
function notesFor(
  capture: CaptureResult,
  annotations: ReadonlyArray<MapAnnotation>,
): Array<ExportNote> {
  return annotations.flatMap((a, i) =>
    annotationVisibleOn(a, capture.slot)
      ? [{ number: i + 1, text: a.text }]
      : [],
  )
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

  const withCaptures = async (
    use: (
      captures: Array<CaptureResult>,
      loadedLegends: Array<LoadedLegend>,
    ) => void,
  ) => {
    if (!capture) return
    try {
      const [captures, images] = await Promise.all([
        capture(),
        Promise.all(legends.map((l) => loadLegendImage(l.url))),
      ])
      if (captures.length === 0) {
        showToast.error(t('export.failed'))
        return
      }
      // Failed legend loads are dropped silently — the map still exports.
      const loadedLegends = legends.flatMap((spec, i) => {
        const image = images[i]
        return image
          ? [
              {
                slot: spec.slot,
                title: `${spec.slot.toUpperCase()} · ${spec.title}`,
                image,
              },
            ]
          : []
      })
      use(captures, loadedLegends)
    } catch (err) {
      log.error('Comparison export failed', { error: err })
      showToast.error(t('export.failed'))
    }
  }

  const downloadPng = () =>
    withCaptures((captures, loadedLegends) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      captures.forEach((c, i) => {
        // Bake title + time + this capture's legends so the PNG is
        // self-describing outside the report.
        const composed = composeExportCanvas(c.canvas, {
          titles: [title.trim() || c.label],
          timeText: c.timeLabel,
          titleBarEnabled: true,
          legendItems: legendsFor(c, loadedLegends),
          notes: notesFor(c, annotations),
        })
        if (!composed) return
        const a = document.createElement('a')
        a.href = composed.toDataURL('image/png')
        a.download = `compare-${stamp}${captures.length > 1 ? `-${i + 1}` : ''}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
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
