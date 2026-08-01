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
 * Export/copy plumbing for the compare viewer: map components register a
 * capture action; copy composes captures + legends + annotation notes
 * into a clipboard PNG, per-slot via a captureOnly re-render.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canvasToPngBlob, joinCanvasesHorizontally } from '../map-export'
import { rebaseLensUrl } from '../wms-capabilities'
import { composeCaptures } from './export-pipeline'
import type { LensSource } from '../hooks/useLensSource'
import type { MapAnnotation } from './annotations'
import type { SourceSlot } from './layer-pairing'
import type { CaptureResult } from './types'
import { copyToClipboard } from '@/lib/clipboard'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'

const log = createLogger('useViewerExport')

export function useViewerExport({
  aBaseUrl,
  bBaseUrl,
  sourceA,
  sourceB,
  activeOrderA,
  activeOrderB,
  annotations,
}: {
  aBaseUrl: string
  bBaseUrl: string | null
  sourceA: LensSource
  sourceB: LensSource
  activeOrderA: ReadonlyArray<string>
  activeOrderB: ReadonlyArray<string>
  annotations: ReadonlyArray<MapAnnotation>
}) {
  const { t: tExec } = useTranslation('executions')

  const [captureAction, setCaptureAction] = useState<
    (() => Promise<Array<CaptureResult>>) | null
  >(null)
  // Mirrored in a ref: captureFor invokes the action AFTER waiting out a
  // captureOnly re-render, so it must read the registration made for that
  // render — its own state binding still closes over captureOnly = null.
  const captureActionRef = useRef<(() => Promise<Array<CaptureResult>>) | null>(
    null,
  )
  const onRegisterCapture = useCallback(
    (capture: (() => Promise<Array<CaptureResult>>) | null) => {
      captureActionRef.current = capture
      setCaptureAction(() => capture)
    },
    [],
  )
  const [exportOpen, setExportOpen] = useState(false)

  // Per-slot copy re-renders the single map with only that slot showing;
  // side-by-side just filters its per-map captures.
  const [captureOnly, setCaptureOnly] = useState<SourceSlot | null>(null)
  const captureFor = async (
    only: SourceSlot | null,
  ): Promise<Array<CaptureResult>> => {
    const capture = captureActionRef.current
    if (!capture) throw new Error('Capture unavailable')
    if (only === null) return capture()
    setCaptureOnly(only)
    try {
      // Two frames: React commit, then OL applies the opacity change.
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      )
      const results = await (captureActionRef.current ?? capture)()
      return results.filter((c) => c.slot === only)
    } finally {
      setCaptureOnly(null)
    }
  }

  // Active layers' legends for the export (per slot, lens URLs rebased,
  // external URLs verbatim — rebaseLensUrl handles both).
  const exportLegends = useMemo(() => {
    const specs: Array<{ slot: SourceSlot; title: string; url: string }> = []
    const slots: Array<
      readonly [SourceSlot, typeof sourceA, string, ReadonlyArray<string>]
    > = [['a', sourceA, aBaseUrl, activeOrderA]]
    if (bBaseUrl !== null) {
      slots.push(['b', sourceB, bBaseUrl, activeOrderB])
    }
    for (const [slot, source, baseUrl, order] of slots) {
      for (const name of order) {
        const layer = source.layers.find((l) => l.name === name)
        const legendUrl = layer?.styles[0]?.legendUrl
        if (!layer || !legendUrl) continue
        specs.push({
          slot,
          title: layer.title,
          url: rebaseLensUrl(legendUrl, baseUrl),
        })
      }
    }
    return specs
  }, [sourceA, sourceB, aBaseUrl, bBaseUrl, activeOrderA, activeOrderB])

  // Unawaited promise: the item must be built inside the gesture (Safari).
  // Combined view joins side-by-side maps into one image — the clipboard
  // holds a single item.
  const copyView = (only: SourceSlot | null) => {
    if (!captureAction) return
    copyToClipboard(
      'image/png',
      composeCaptures({
        capture: () => captureFor(only),
        legends: exportLegends,
        annotations,
      }).then((canvases) => {
        const joined = joinCanvasesHorizontally(canvases)
        return joined ? canvasToPngBlob(joined) : null
      }),
    )
      .then(() => showToast.success(tExec('lens.mapCopied')))
      .catch((err: unknown) => {
        log.error('View copy failed', { error: err })
        showToast.error(tExec('lens.mapCopyFailed'))
      })
  }

  return {
    onRegisterCapture,
    captureAction,
    captureOnly,
    exportOpen,
    setExportOpen,
    copyView,
    exportLegends,
  }
}
