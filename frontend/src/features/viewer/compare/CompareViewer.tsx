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
 * Synchronized two-source WMS comparison viewer.
 *
 * Owns: per-source capabilities (useLensSource ×2), the pairing/selection
 * model (linked by default, auto-unlinks on zero overlap), the shared
 * epoch-keyed valid-time timeline, one persistent `ol/View` (camera
 * survives mode switches — maps remount, the View doesn't), and the mode
 * toolbar. Map mechanics live in SingleMapCompare / DualMapCompare.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import 'ol/ol.css'
import { Loader2, RefreshCw } from 'lucide-react'
import { useLensSource } from '../hooks/useLensSource'
import { createViewerView } from '../hooks/useOlMapBase'
import { buildPairs } from './layer-pairing'
import {
  buildCompareTimeline,
  buildSourceTimeIndex,
  locateEpoch,
} from './compare-timeline'
import { useCompareSelection } from './useCompareSelection'
import { CompareToolbar } from './CompareToolbar'
import { CompareTimeSlider } from './CompareTimeSlider'
import { DualMapCompare } from './DualMapCompare'
import { LinkedLayerBrowser } from './LinkedLayerBrowser'
import { SingleMapCompare } from './SingleMapCompare'
import type View from 'ol/View'
import type { ParsedLayer } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'
import type { CompareMapSource, CompareMode } from './types'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'

export interface CompareViewerSource {
  baseUrl: string
  label: string
}

export function CompareViewer({
  a,
  b,
  mode,
  onModeChange,
}: {
  a: CompareViewerSource
  b: CompareViewerSource
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
}) {
  const { t } = useTranslation('compare')
  const { t: tExec } = useTranslation('executions')

  const sourceA = useLensSource(a.baseUrl)
  const sourceB = useLensSource(b.baseUrl)

  // One View for the lifetime of the comparison: camera state survives
  // mode switches and source swaps.
  const viewRef = useRef<View | null>(null)
  viewRef.current ??= createViewerView()

  // -------- Pairing + selection --------
  const pairing = useMemo(
    () => buildPairs(sourceA.groups, sourceB.groups),
    [sourceA.groups, sourceB.groups],
  )
  const selection = useCompareSelection(pairing.pairs)

  const bothReady = !sourceA.loadingLayers && !sourceB.loadingLayers
  const zeroOverlap = bothReady && pairing.overlapCount === 0
  useEffect(() => {
    if (zeroOverlap && selection.linkMode === 'linked') {
      selection.setLinkMode('unlinked', { auto: true })
    }
    // Intentionally keyed on the meaningful bits only — the selection
    // object's identity changes every render.
  }, [zeroOverlap, selection.linkMode])

  const activeOrderA = selection.activeOrderFor('a')
  const activeOrderB = selection.activeOrderFor('b')

  // -------- Valid-time alignment (epoch-keyed union) --------
  const timeIndexA = useMemo(
    () => buildSourceTimeIndex(sourceA.layers, activeOrderA),
    [sourceA.layers, activeOrderA],
  )
  const timeIndexB = useMemo(
    () => buildSourceTimeIndex(sourceB.layers, activeOrderB),
    [sourceB.layers, activeOrderB],
  )
  const timeline = useMemo(
    () => buildCompareTimeline(timeIndexA, timeIndexB),
    [timeIndexA, timeIndexB],
  )
  const [timeStep, setTimeStep] = useState(0)
  // Re-locate the selected instant when the union changes (layer add/
  // remove) instead of snapping to 0.
  const lastEpochRef = useRef<number | null>(null)
  useEffect(() => {
    const located = locateEpoch(timeline.epochs, lastEpochRef.current)
    // Functional update: `timeStep` stays out of the deps on purpose —
    // this must run only when the union changes, not on every scrub.
    if (located >= 0) setTimeStep((step) => (step === located ? step : located))
  }, [timeline.epochs])
  const onTimeChange = useCallback(
    (index: number) => {
      setTimeStep(index)
      lastEpochRef.current =
        index >= 0 && index < timeline.epochs.length
          ? timeline.epochs[index]
          : null
    },
    [timeline.epochs],
  )

  const safeStep = Math.max(0, Math.min(timeStep, timeline.epochs.length - 1))
  const currentEpoch: number | null =
    timeline.epochs.length > 0 ? timeline.epochs[safeStep] : null

  const resolveTimeFor = useCallback(
    (slot: SourceSlot) => {
      const index = slot === 'a' ? timeIndexA : timeIndexB
      return (layer: ParsedLayer): string | null => {
        if (!layer.time || currentEpoch === null) return null
        // Exact-only v1: gaps hide the source (never silently substitute).
        return index.rawByEpoch.get(currentEpoch) ?? null
      }
    },
    [timeIndexA, timeIndexB, currentEpoch],
  )

  const hiddenAtTime = (slot: SourceSlot): boolean => {
    if (currentEpoch === null) return false
    const index = slot === 'a' ? timeIndexA : timeIndexB
    return index.epochs.length > 0 && !index.rawByEpoch.has(currentEpoch)
  }

  // -------- Fit plumbing (map components register their fit action) ----
  const [fitAction, setFitAction] = useState<(() => void) | null>(null)
  const onRegisterFit = useCallback(
    (fit: (() => void) | null) => setFitAction(() => fit),
    [],
  )

  // -------- Source view-model for the map components --------
  const mapSourceA: CompareMapSource = {
    slot: 'a',
    baseUrl: a.baseUrl,
    label: a.label,
    layers: sourceA.layers,
    activeOrder: activeOrderA,
    layerOpacities: selection.opacitiesFor('a'),
    resolveTime: resolveTimeFor('a'),
    hiddenAtTime: hiddenAtTime('a'),
    bbox: sourceA.bbox,
  }
  const mapSourceB: CompareMapSource = {
    slot: 'b',
    baseUrl: b.baseUrl,
    label: b.label,
    layers: sourceB.layers,
    activeOrder: activeOrderB,
    layerOpacities: selection.opacitiesFor('b'),
    resolveTime: resolveTimeFor('b'),
    hiddenAtTime: hiddenAtTime('b'),
    bbox: sourceB.bbox,
  }

  // -------- Capabilities load/error surface --------
  const sourceError = sourceA.error ?? sourceB.error
  if (sourceError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-6 text-center text-sm">
        <P className="max-w-md text-destructive">{sourceError}</P>
        <P className="text-xs text-muted-foreground">{t('panel.corsHint')}</P>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            sourceA.retry()
            sourceB.retry()
          }}
          className="gap-1.5"
        >
          <RefreshCw className="h-3 w-3" />
          {tExec('lens.retry')}
        </Button>
      </div>
    )
  }
  if (!bothReady) {
    return (
      <div className="flex h-full items-center justify-center gap-2 rounded-md border border-border bg-card text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tExec('lens.loadingLayers')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <CompareToolbar
        mode={mode}
        onModeChange={onModeChange}
        linkMode={selection.linkMode}
        onLinkModeChange={(next) => selection.setLinkMode(next)}
        linkDisabled={zeroOverlap}
        onFit={fitAction}
      />
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="min-h-0 min-w-0 flex-1">
          {mode === 'side' ? (
            <DualMapCompare
              view={viewRef.current}
              a={mapSourceA}
              b={mapSourceB}
              onRegisterFit={onRegisterFit}
            />
          ) : (
            <SingleMapCompare
              view={viewRef.current}
              a={mapSourceA}
              b={mapSourceB}
              mode={mode}
              onRegisterFit={onRegisterFit}
            />
          )}
        </div>
        <LinkedLayerBrowser
          pairs={pairing.pairs}
          selection={selection}
          sourceA={sourceA}
          sourceB={sourceB}
          baseUrlA={a.baseUrl}
          baseUrlB={b.baseUrl}
        />
      </div>
      <CompareTimeSlider
        timeline={timeline}
        index={safeStep}
        onChange={onTimeChange}
      />
    </div>
  )
}
