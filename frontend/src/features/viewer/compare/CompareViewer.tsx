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
import {
  defaultToleranceMs,
  formatOffset,
  resolveSourceTime,
} from './time-link'
import { formatStep } from '../format'
import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  IMAGERY_BASEMAPS,
  SKINNYWMS_BASEMAP,
} from '../ol-layers'
import { rebaseLensUrl, skinnyWmsBasemap } from '../wms-capabilities'
import { CompareToolbar } from './CompareToolbar'
import { CompareExportDialog } from './CompareExportDialog'
import { CompareHelpDialog } from './CompareHelpDialog'
import { useCompareShortcuts } from './useCompareShortcuts'
import type { ContextOverlay } from './overlays'
import { CompareTimeSlider } from './CompareTimeSlider'
import { CompareActiveLayersPanel } from './CompareActiveLayersPanel'
import { CollapsedSidebarHandle } from '../components/CollapsedSidebarHandle'
import { CompareLayerBrowser } from './CompareLayerBrowser'
import { DualMapCompare } from './DualMapCompare'
import { SingleMapCompare } from './SingleMapCompare'
import type View from 'ol/View'
import type { ParsedLayer } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'
import type {
  CaptureResult,
  CompareMapSource,
  CompareMode,
  CompareModeOptions,
} from './types'
import type { TimeLinkMode } from './time-link'
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

  // Opacity hierarchy: global × per-source × per-layer (per-layer lives in
  // the selection; the product of the first two feeds the map stacks).
  const [globalOpacity, setGlobalOpacity] = useState(1)
  const [sourceOpacity, setSourceOpacity] = useState<
    Record<SourceSlot, number>
  >({ a: 1, b: 1 })
  const setSourceOpacityFor = useCallback(
    (slot: SourceSlot, value: number) =>
      setSourceOpacity((prev) => ({ ...prev, [slot]: value })),
    [],
  )

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

  // Measure tools (mode-independent): current tool + clear signal.
  const [measureMode, setMeasureMode] = useState<'none' | 'line' | 'area'>(
    'none',
  )
  const [measureClearNonce, setMeasureClearNonce] = useState(0)

  // Per-mode tuning surfaced in the toolbar's action row.
  const [modeOptions, setModeOptions] = useState<CompareModeOptions>({
    swipeOrientation: 'vertical',
    spyShape: 'circle',
    spySizePx: 90,
    blend: 0.6,
  })

  // -------- Time-link policy (exact / nearest / offset / independent) --
  const [timeLinkMode, setTimeLinkMode] = useState<TimeLinkMode>('exact')
  const [offsetMs, setOffsetMs] = useState(0)
  const [indepIndex, setIndepIndex] = useState<Record<SourceSlot, number>>({
    a: 0,
    b: 0,
  })

  const resolvedA = useMemo(() => {
    if (timeLinkMode === 'independent') {
      const i = Math.max(
        0,
        Math.min(indepIndex.a, timeIndexA.epochs.length - 1),
      )
      const epoch = timeIndexA.epochs.length > 0 ? timeIndexA.epochs[i] : null
      return {
        raw: epoch !== null ? (timeIndexA.rawByEpoch.get(epoch) ?? null) : null,
        epoch,
        offsetMs: null,
        hidden: false,
      }
    }
    return resolveSourceTime(
      timeIndexA,
      currentEpoch,
      timeLinkMode === 'exact' ? 'exact' : 'nearest',
      defaultToleranceMs(timeIndexA),
    )
  }, [timeLinkMode, indepIndex.a, timeIndexA, currentEpoch])

  const resolvedB = useMemo(() => {
    if (timeLinkMode === 'independent') {
      const i = Math.max(
        0,
        Math.min(indepIndex.b, timeIndexB.epochs.length - 1),
      )
      const epoch = timeIndexB.epochs.length > 0 ? timeIndexB.epochs[i] : null
      return {
        raw: epoch !== null ? (timeIndexB.rawByEpoch.get(epoch) ?? null) : null,
        epoch,
        offsetMs: null,
        hidden: false,
      }
    }
    const target =
      timeLinkMode === 'offset' && currentEpoch !== null
        ? currentEpoch + offsetMs
        : currentEpoch
    return resolveSourceTime(
      timeIndexB,
      target,
      timeLinkMode === 'exact' ? 'exact' : 'nearest',
      defaultToleranceMs(timeIndexB),
    )
  }, [timeLinkMode, indepIndex.b, timeIndexB, currentEpoch, offsetMs])

  const resolvedFor = (slot: SourceSlot) =>
    slot === 'a' ? resolvedA : resolvedB

  const resolveTimeFor = useCallback(
    (slot: SourceSlot) => {
      const resolved = slot === 'a' ? resolvedA : resolvedB
      return (layer: ParsedLayer): string | null =>
        layer.time ? resolved.raw : null
    },
    [resolvedA, resolvedB],
  )

  // Offset tag relative to the SHARED axis (A's requested instant), so a
  // fixed-Δ B honestly reads e.g. "B +6 h".
  const timeTagFor = (slot: SourceSlot): string | null => {
    if (timeLinkMode === 'independent') return null
    const resolved = resolvedFor(slot)
    if (resolved.epoch === null || currentEpoch === null) return null
    const delta = resolved.epoch - currentEpoch
    return delta === 0 ? null : formatOffset(delta)
  }

  // -------- Fit plumbing (map components register their fit action) ----
  const [fitAction, setFitAction] = useState<(() => void) | null>(null)
  const onRegisterFit = useCallback(
    (fit: (() => void) | null) => setFitAction(() => fit),
    [],
  )

  // -------- Export (map components register their capture action) ------
  const [captureAction, setCaptureAction] = useState<
    (() => Promise<Array<CaptureResult>>) | null
  >(null)
  const onRegisterCapture = useCallback(
    (capture: (() => Promise<Array<CaptureResult>>) | null) =>
      setCaptureAction(() => capture),
    [],
  )
  const [exportOpen, setExportOpen] = useState(false)

  // Active layers' legends for the export (per slot, lens URLs rebased,
  // external URLs verbatim — rebaseLensUrl handles both).
  const exportLegends = useMemo(() => {
    const specs: Array<{ slot: SourceSlot; title: string; url: string }> = []
    for (const [slot, source, baseUrl, order] of [
      ['a', sourceA, a.baseUrl, activeOrderA],
      ['b', sourceB, b.baseUrl, activeOrderB],
    ] as const) {
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
  }, [sourceA, sourceB, a.baseUrl, b.baseUrl, activeOrderA, activeOrderB])

  // Basemap — one choice driving every panel, embedded-viewer options.
  const [basemapId, setBasemapId] = useState<string>(DEFAULT_BASEMAP_ID)
  const [basemapOpacity, setBasemapOpacity] = useState(1)
  const availableBasemaps = useMemo(() => {
    // SkinnyWMS native background comes from A's lens (the canvas host in
    // single-map modes); dual panels fall back per-side when B lacks one.
    const hasSkinny =
      skinnyWmsBasemap(sourceA.decorationLayers).background !== undefined
    return [
      ...BASEMAPS,
      ...IMAGERY_BASEMAPS,
      ...(hasSkinny ? [SKINNYWMS_BASEMAP] : []),
    ]
  }, [sourceA.decorationLayers])

  // Sidebar collapse — same affordance as the embedded viewer.
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useCompareShortcuts({
    // Any sidebar open → collapse both; both collapsed → restore both.
    onToggleSidebars: () => {
      const collapse = !(leftCollapsed && rightCollapsed)
      setLeftCollapsed(collapse)
      setRightCollapsed(collapse)
    },
    onMode: onModeChange,
    onFit: fitAction,
    onExport: () => setExportOpen(true),
    onHelp: () => setHelpOpen((v) => !v),
  })

  // -------- User-uploaded GeoJSON context overlays --------
  const [overlays, setOverlays] = useState<Array<ContextOverlay>>([])
  const addOverlay = useCallback(
    (overlay: ContextOverlay) => setOverlays((prev) => [...prev, overlay]),
    [],
  )
  const toggleOverlay = useCallback(
    (id: string) =>
      setOverlays((prev) =>
        prev.map((o) => (o.id === id ? { ...o, visible: !o.visible } : o)),
      ),
    [],
  )
  const removeOverlay = useCallback(
    (id: string) => setOverlays((prev) => prev.filter((o) => o.id !== id)),
    [],
  )

  // -------- Source view-model for the map components --------
  const mapSourceA: CompareMapSource = {
    slot: 'a',
    baseUrl: a.baseUrl,
    label: a.label,
    layers: sourceA.layers,
    decorationLayers: sourceA.decorationLayers,
    activeOrder: activeOrderA,
    layerOpacities: selection.opacitiesFor('a'),
    resolveTime: resolveTimeFor('a'),
    hiddenAtTime: resolvedA.hidden,
    timeTag: timeTagFor('a'),
    timeLabel:
      resolvedA.epoch !== null
        ? formatStep(new Date(resolvedA.epoch).toISOString())
        : null,
    masterOpacity: globalOpacity * sourceOpacity.a,
    bbox: sourceA.bbox,
  }
  const mapSourceB: CompareMapSource = {
    slot: 'b',
    baseUrl: b.baseUrl,
    label: b.label,
    layers: sourceB.layers,
    decorationLayers: sourceB.decorationLayers,
    activeOrder: activeOrderB,
    layerOpacities: selection.opacitiesFor('b'),
    resolveTime: resolveTimeFor('b'),
    hiddenAtTime: resolvedB.hidden,
    timeTag: timeTagFor('b'),
    timeLabel:
      resolvedB.epoch !== null
        ? formatStep(new Date(resolvedB.epoch).toISOString())
        : null,
    masterOpacity: globalOpacity * sourceOpacity.b,
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
        options={modeOptions}
        onOptionsChange={(patch) =>
          setModeOptions((prev) => ({ ...prev, ...patch }))
        }
        measureMode={measureMode}
        onMeasureMode={setMeasureMode}
        onMeasureClear={() => setMeasureClearNonce((n) => n + 1)}
        onExport={() => setExportOpen(true)}
        basemapId={basemapId}
        onBasemapChange={setBasemapId}
        availableBasemaps={availableBasemaps}
        basemapOpacity={basemapOpacity}
        onBasemapOpacityChange={setBasemapOpacity}
        onHelp={() => setHelpOpen(true)}
      />
      <CompareHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <CompareExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        capture={captureAction}
        legends={exportLegends}
        meta={{ labelA: a.label, labelB: b.label }}
      />
      <div className="flex min-h-0 flex-1 gap-2">
        {leftCollapsed ? (
          <CollapsedSidebarHandle
            side="left"
            onExpand={() => setLeftCollapsed(false)}
          />
        ) : (
          <CompareActiveLayersPanel
            pairs={pairing.pairs}
            selection={selection}
            overlays={{
              items: overlays,
              add: addOverlay,
              toggle: toggleOverlay,
              remove: removeOverlay,
            }}
            opacity={{
              global: globalOpacity,
              setGlobal: setGlobalOpacity,
              source: sourceOpacity,
              setSource: setSourceOpacityFor,
            }}
            sources={{
              a: { label: a.label, baseUrl: a.baseUrl, lens: sourceA },
              b: { label: b.label, baseUrl: b.baseUrl, lens: sourceB },
            }}
            onCollapse={() => setLeftCollapsed(true)}
          />
        )}
        <div className="min-h-0 min-w-0 flex-1">
          {mode === 'side' ? (
            <DualMapCompare
              view={viewRef.current}
              a={mapSourceA}
              b={mapSourceB}
              measureMode={measureMode}
              measureClearNonce={measureClearNonce}
              overlays={overlays}
              basemapId={basemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterCapture={onRegisterCapture}
            />
          ) : (
            <SingleMapCompare
              view={viewRef.current}
              a={mapSourceA}
              b={mapSourceB}
              mode={mode}
              options={modeOptions}
              measureMode={measureMode}
              measureClearNonce={measureClearNonce}
              overlays={overlays}
              basemapId={basemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterCapture={onRegisterCapture}
            />
          )}
        </div>
        {rightCollapsed ? (
          <CollapsedSidebarHandle
            side="right"
            onExpand={() => setRightCollapsed(false)}
          />
        ) : (
          <CompareLayerBrowser
            pairs={pairing.pairs}
            selection={selection}
            sourceA={sourceA}
            sourceB={sourceB}
            onCollapse={() => setRightCollapsed(true)}
          />
        )}
      </div>
      <CompareTimeSlider
        timeline={timeline}
        index={safeStep}
        onChange={onTimeChange}
        linkMode={timeLinkMode}
        onLinkModeChange={setTimeLinkMode}
        offsetMs={offsetMs}
        onOffsetChange={setOffsetMs}
        independent={{
          a: {
            epochs: timeIndexA.epochs,
            index: indepIndex.a,
            onChange: (i) => setIndepIndex((prev) => ({ ...prev, a: i })),
          },
          b: {
            epochs: timeIndexB.epochs,
            index: indepIndex.b,
            onChange: (i) => setIndepIndex((prev) => ({ ...prev, b: i })),
          },
        }}
      />
    </div>
  )
}
