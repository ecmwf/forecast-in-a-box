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
 * Synchronized WMS viewer for one or two sources. With `b` null it runs
 * solo (no mode switcher / link toggle / B track); comparison controls
 * appear in place when B arrives — selection survives because pair keys
 * are source-independent, and the camera survives because the `ol/View`
 * is persistent.
 *
 * Composition root. Owns: per-source capabilities (useLensSource ×2),
 * the pairing/selection model, one persistent `ol/View` (camera survives
 * mode switches — maps remount, the View doesn't), mode/focus state, the
 * GetMap failure log, and the sidebar/sheet layout. Subsystems live in
 * hooks — useViewerTimeline (axis + link policy), useViewerAnnotations,
 * useViewerUrlState (restore/report), useViewerExport (capture/copy) —
 * and map mechanics in SingleMapView / DualMapView.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import 'ol/ol.css'
import { RefreshCw } from 'lucide-react'
import { fromLonLat } from 'ol/proj'
import { useLensSource } from '../hooks/useLensSource'
import { AUTOFIT_KEY, createViewerView } from '../hooks/useOlMapBase'
import { formatStep } from '../format'
import { BASEMAPS, DEFAULT_BASEMAP_ID, SKINNYWMS_BASEMAP } from '../ol-layers'
import {
  isLoopbackUrl,
  rebaseLensUrl,
  skinnyWmsBasemap,
} from '../wms-capabilities'
import { CollapsedSidebarHandle } from '../components/CollapsedSidebarHandle'
import { buildPairs } from './layer-pairing'
import { useCompareSelection } from './useCompareSelection'
import { useGetMapFailureLog } from './getmap-failures'
import { GeoViewerSkeleton } from './GeoViewerSkeleton'
import { GeoToolbar } from './GeoToolbar'
import { GeoExportDialog } from './GeoExportDialog'
import { CompareHelpDialog } from './CompareHelpDialog'
import { AnnotationEditorDialog } from './AnnotationEditorDialog'
import { useViewerAnnotations } from './useViewerAnnotations'
import { useViewerUrlState } from './useViewerUrlState'
import { useViewerExport } from './useViewerExport'
import { useViewerTimeline } from './useViewerTimeline'
import { downloadAnnotationsGeojson } from './annotations'
import { useGeoShortcuts } from './useGeoShortcuts'
import { GeoTimeSlider } from './GeoTimeSlider'
import { GeoActiveLayersPanel } from './GeoActiveLayersPanel'
import { GeoLayerBrowser } from './GeoLayerBrowser'
import { DualMapView } from './DualMapView'
import { SingleMapView } from './SingleMapView'
import type { MapAnnotation } from './annotations'
import type { ContextOverlay } from './overlays'
import type View from 'ol/View'
import type { SourceSlot } from './layer-pairing'
import type { CompareMapSource, CompareMode, CompareModeOptions } from './types'
import type { MeasureMode } from '../hooks/useMeasure'
import type { ViewerUrlState } from './view-url-state'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { P } from '@/components/base/typography'
import { useMedia } from '@/hooks/useMedia'

export interface GeoViewerSource {
  /** Stable source identity (basket entry ref) — annotations bind to it. */
  id: string
  baseUrl: string
  label: string
}

export function GeoViewer({
  a,
  b = null,
  mode,
  onModeChange,
  onRemoveB,
  initialViewState,
  onViewStateChange,
}: {
  a: GeoViewerSource
  /** Second source; null runs the viewer solo. */
  b?: GeoViewerSource | null
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  /** Clear slot B (offered when B fails). */
  onRemoveB?: () => void
  /** URL-restored view state, read once at mount (later changes ignored). */
  initialViewState?: ViewerUrlState
  /** Live view-state partials; the page debounces them into the URL. */
  onViewStateChange?: (partial: Partial<ViewerUrlState>) => void
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')

  const hasB = b !== null
  const bId = b?.id ?? null
  const sourceA = useLensSource(a.baseUrl)
  const sourceB = useLensSource(b?.baseUrl ?? null)

  // Mount snapshot — restoration must not react to later URL rewrites.
  const initialViewRef = useRef(initialViewState ?? null)

  // One View for the lifetime of the comparison: camera state survives
  // mode switches and source swaps.
  const viewRef = useRef<View | null>(null)
  if (viewRef.current === null) {
    viewRef.current = createViewerView()
    const cam = initialViewRef.current?.camera
    if (cam) {
      viewRef.current.setCenter(fromLonLat([cam.lon, cam.lat]))
      viewRef.current.setZoom(cam.zoom)
      // A restored camera outranks the initial auto-fit.
      viewRef.current.set(AUTOFIT_KEY, true, true)
    }
  }

  // -------- Pairing + selection --------
  const pairing = useMemo(
    () => buildPairs(sourceA.groups, sourceB.groups),
    [sourceA.groups, sourceB.groups],
  )
  const selection = useCompareSelection(pairing.pairs)

  const bothReady = !sourceA.loadingLayers && !sourceB.loadingLayers
  // Solo always has zero overlap — never auto-unlink there, it would
  // destroy the pair-key selection that carries over when B arrives.
  const zeroOverlap = hasB && bothReady && pairing.overlapCount === 0
  useEffect(() => {
    if (!bothReady) return
    if (zeroOverlap) {
      if (selection.linkMode === 'linked') {
        selection.setLinkMode('unlinked', { auto: true })
      }
    } else if (selection.autoUnlinked && (!hasB || pairing.overlapCount > 0)) {
      // The auto-unlink was situational — undo it once sources share
      // layers again (a manual unlink is never overridden).
      selection.setLinkMode('linked')
    }
    // Intentionally keyed on the meaningful bits only — the selection
    // object's identity changes every render.
  }, [
    zeroOverlap,
    bothReady,
    hasB,
    pairing.overlapCount,
    selection.linkMode,
    selection.autoUnlinked,
  ])

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

  // Measure tools (mode-independent): current tool + clear signal.
  const [measureMode, setMeasureMode] = useState<MeasureMode>('none')
  const [measureClearNonce, setMeasureClearNonce] = useState(0)

  // Per-mode tuning surfaced in the toolbar's action row.
  const [modeOptions, setModeOptions] = useState<CompareModeOptions>({
    swipeOrientation: 'vertical',
    spyShape: 'circle',
    spySizePx: 90,
    blend: 0.6,
    loupeMirror: true,
    loupeSizePx: 180,
    loupeZoom: 2,
    loupeLatched: false,
  })

  // -------- GetMap failure cache (advertised-but-not-served instants) --
  const failures = useGetMapFailureLog()
  const { report: reportLoad, clearSlot: clearFailures } = failures
  const onLoadResultA = useCallback(
    (layer: string, time: string | null, ok: boolean) =>
      reportLoad('a', layer, time, ok),
    [reportLoad],
  )
  const onLoadResultB = useCallback(
    (layer: string, time: string | null, ok: boolean) =>
      reportLoad('b', layer, time, ok),
    [reportLoad],
  )
  // Marks are evidence about ONE capability set — drop them when the
  // source or its advertised content changes (a new model run). Layer
  // identity is content-tracked (TanStack structural sharing), so a
  // no-change background refetch keeps the marks.
  useEffect(
    () => clearFailures('a'),
    [clearFailures, a.baseUrl, sourceA.layers],
  )
  useEffect(
    () => clearFailures('b'),
    [clearFailures, b?.baseUrl, sourceB.layers],
  )
  // A deactivated layer's marks would otherwise linger until the TTL,
  // painting failures the display no longer contains.
  const retainFailureLayers = failures.retainLayers
  useEffect(
    () => retainFailureLayers('a', activeOrderA),
    [retainFailureLayers, activeOrderA],
  )
  useEffect(
    () => retainFailureLayers('b', activeOrderB),
    [retainFailureLayers, activeOrderB],
  )
  // -------- Valid-time alignment + link policy --------
  const {
    timeIndexA,
    timeIndexB,
    timeline,
    displayTimeline,
    rawStepsA,
    rawStepsB,
    safeStep,
    currentEpoch,
    onTimeChange,
    timeClip,
    setTimeClip,
    timeLinkMode,
    setTimeLinkMode,
    offsetMs,
    setOffsetMs,
    offsetMeta,
    indepIndex,
    setIndepIndex,
    onSlotsSwapped,
    resolvedA,
    resolvedB,
    resolveTimeA,
    resolveTimeB,
    hoverTimes,
    trackFailures,
    timeTagFor,
  } = useViewerTimeline({
    sourceA,
    sourceB,
    activeOrderA,
    activeOrderB,
    initial: initialViewRef.current,
    failedLayers: failures.failedLayers,
  })

  // -------- Fit plumbing (map components register their fit action) ----
  const [fitAction, setFitAction] = useState<(() => void) | null>(null)
  const onRegisterFit = useCallback(
    (fit: (() => void) | null) => setFitAction(() => fit),
    [],
  )

  const bBaseUrl = b?.baseUrl ?? null

  // Basemap — one choice driving every panel.
  const [basemapId, setBasemapId] = useState<string>(
    () => initialViewRef.current?.basemap ?? DEFAULT_BASEMAP_ID,
  )
  const [basemapOpacity, setBasemapOpacity] = useState(1)
  const availableBasemaps = useMemo(() => {
    // SkinnyWMS native background comes from A's lens (the canvas host in
    // single-map modes); dual panels fall back per-side when B lacks one.
    const hasSkinny =
      skinnyWmsBasemap(sourceA.decorationLayers).background !== null
    return [...BASEMAPS, ...(hasSkinny ? [SKINNYWMS_BASEMAP] : [])]
  }, [sourceA.decorationLayers])
  // Snap back when a swap drops the option — after A settles (restored SkinnyWMS).
  useEffect(() => {
    if (sourceA.loadingLayers) return
    if (!availableBasemaps.some((opt) => opt.id === basemapId)) {
      setBasemapId(DEFAULT_BASEMAP_ID)
    }
  }, [availableBasemaps, basemapId, sourceA.loadingLayers])

  // -------- URL view-state restore + report --------
  useViewerUrlState({
    initial: initialViewRef.current,
    onViewStateChange,
    viewRef,
    selection,
    pairing,
    sourceA,
    sourceB,
    hasB,
    activeOrderA,
    activeOrderB,
    currentEpoch,
    timeLinkMode,
    offsetMs,
    basemapId,
  })

  // Time-step prefetch (default off — bandwidth-heavy).
  const [preloadTimeSteps, setPreloadTimeSteps] = useState(false)

  // Pinned legends, keyed `${slot}:${layerName}`.
  const [pinnedLegends, setPinnedLegends] = useState<Set<string>>(new Set())
  const togglePinLegend = useCallback((slot: SourceSlot, name: string) => {
    const key = `${slot}:${name}`
    setPinnedLegends((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const pinnedLegendItems = useMemo(() => {
    return Array.from(pinnedLegends).flatMap((key) => {
      const sep = key.indexOf(':')
      const slot = key.slice(0, sep) as SourceSlot
      const name = key.slice(sep + 1)
      const source = slot === 'a' ? sourceA : sourceB
      const base = slot === 'a' ? a.baseUrl : bBaseUrl
      const activeOrder = slot === 'a' ? activeOrderA : activeOrderB
      const layer = source.layers.find((l) => l.name === name)
      const legendUrl = layer?.styles[0]?.legendUrl
      // Hide pins whose layer is no longer selected — restored if re-added.
      if (base === null || !layer || !legendUrl || !activeOrder.includes(name))
        return []
      return [
        {
          key,
          slot,
          title: hasB ? `${slot.toUpperCase()} · ${layer.title}` : layer.title,
          url: rebaseLensUrl(legendUrl, base),
        },
      ]
    })
  }, [
    pinnedLegends,
    sourceA,
    sourceB,
    a.baseUrl,
    bBaseUrl,
    hasB,
    activeOrderA,
    activeOrderB,
  ])
  const unpinLegend = useCallback(
    (key: string) =>
      setPinnedLegends((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      }),
    [],
  )

  // Source focus: a slot views only that source (UI collapses to it); null compares both.
  const [focusSlot, setFocusSlot] = useState<SourceSlot | null>(null)

  // A swap exchanges the slots' content — slot-keyed working state follows it.
  const prevIdsRef = useRef<{ a: string; b: string | null }>({
    a: a.id,
    b: bId,
  })
  const swapSelectionSlots = selection.onSlotsSwapped
  useEffect(() => {
    const prev = prevIdsRef.current
    prevIdsRef.current = { a: a.id, b: bId }
    if (!(prev.a === bId && prev.b === a.id && a.id !== bId)) return
    setSourceOpacity((p) => ({ a: p.b, b: p.a }))
    setPinnedLegends(
      (p) =>
        new Set(
          Array.from(p).map((k) =>
            k.startsWith('a:') ? `b:${k.slice(2)}` : `a:${k.slice(2)}`,
          ),
        ),
    )
    setFocusSlot((f) => (f === 'a' ? 'b' : f === 'b' ? 'a' : null))
    swapSelectionSlots()
    onSlotsSwapped()
  }, [a.id, bId, swapSelectionSlots, onSlotsSwapped])

  useEffect(() => {
    if (!hasB && focusSlot !== null) setFocusSlot(null)
  }, [hasB, focusSlot])
  // Focus = one source, no pairs: force unlinked (lossless) while focused, restore on exit.
  const preFocusLinked = useRef(false)
  useEffect(() => {
    if (focusSlot !== null) {
      if (selection.linkMode === 'linked') {
        preFocusLinked.current = true
        selection.setLinkMode('unlinked')
      }
    } else if (preFocusLinked.current) {
      preFocusLinked.current = false
      selection.setLinkMode('linked')
    }
  }, [focusSlot, selection.linkMode])

  // Sidebar collapse.
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  // Below lg the sidebars crush the map — auto-collapse; handles reopen.
  const wideViewport = useMedia('(min-width: 1024px)')
  // Below lg an open sidebar is a modal sheet: one at a time, scrim closes.
  const sheetViewport = useMedia('(max-width: 1023px)')
  useLayoutEffect(() => {
    setLeftCollapsed(!wideViewport)
    setRightCollapsed(!wideViewport)
  }, [wideViewport])
  const sheetOpen = sheetViewport && (!leftCollapsed || !rightCollapsed)
  const closeSheets = () => {
    setLeftCollapsed(true)
    setRightCollapsed(true)
  }
  const expandLeft = () => {
    setLeftCollapsed(false)
    if (sheetViewport) setRightCollapsed(true)
  }
  const expandRight = () => {
    setRightCollapsed(false)
    if (sheetViewport) setLeftCollapsed(true)
  }
  const [helpOpen, setHelpOpen] = useState(false)

  // -------- Annotations: labeled findings pinned to the map ---------
  // Measure and annotate both consume map clicks — arming one disarms the other.
  const {
    annotations,
    leaveBlocker,
    annotateArmed,
    toggleAnnotate,
    disarmAnnotate,
    annotationDraft,
    annotationDraftLocation,
    onAnnotationCreate,
    onAnnotationEdit,
    saveAnnotation,
    deleteAnnotation,
    closeAnnotationEditor,
    removeAnnotationById,
    moveAnnotation,
    importAnnotations,
    locateAnnotation,
    annotationHighlightId,
    setAnnotationHighlightId,
  } = useViewerAnnotations({
    viewRef,
    onToggle: () => setMeasureMode('none'),
  })
  const setMeasureModeExclusive = useCallback(
    (measure: MeasureMode) => {
      if (measure !== 'none') disarmAnnotate()
      setMeasureMode(measure)
    },
    [disarmAnnotate],
  )
  // Sidebar attribution is derived, so a swap flips the shown letters.
  const annotationAttribution = useCallback(
    (ann: MapAnnotation) => {
      if (ann.sourceId === null) return t('annotations.slotShared')
      const slots = (['a', 'b'] as const).filter(
        (s) => (s === 'a' ? a.id : bId) === ann.sourceId,
      )
      return slots.length > 0
        ? slots.map((s) => s.toUpperCase()).join(' · ')
        : t('annotations.notShown')
    },
    [a.id, bId, t],
  )

  // Immediate, extent-constrained nudge — the WASD rAF loop calls this
  // each frame, so per-frame moves compose into one smooth pan.
  const onPan = useCallback((dx: number, dy: number) => {
    const view = viewRef.current
    const center = view?.getCenter()
    const resolution = view?.getResolution()
    if (!view || !center || resolution === undefined) return
    const target: [number, number] = [
      center[0] + dx * resolution,
      center[1] - dy * resolution,
    ]
    view.setCenter(view.getConstrainedCenter(target, resolution) ?? target)
  }, [])

  // Live resolution drives the panel's scale-band (zoom-range) hints.
  const [viewResolution, setViewResolution] = useState<number | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const update = () => setViewResolution(view.getResolution() ?? null)
    update()
    view.on('change:resolution', update)
    return () => view.un('change:resolution', update)
  }, [])
  const onZoomToResolution = useCallback((res: number) => {
    viewRef.current?.animate({ resolution: res, duration: 350 })
  }, [])

  // -------- Export (map components register their capture action) ------
  const {
    onRegisterCapture,
    captureAction,
    captureOnly,
    exportOpen,
    setExportOpen,
    copyView,
    exportLegends,
  } = useViewerExport({
    aBaseUrl: a.baseUrl,
    bBaseUrl,
    sourceA,
    sourceB,
    activeOrderA,
    activeOrderB,
    annotations,
    slotIds: { a: a.id, b: bId },
  })

  useGeoShortcuts({
    // Any open → collapse both; else restore (one sheet only on phones).
    onToggleSidebars: () => {
      if (!(leftCollapsed && rightCollapsed)) return closeSheets()
      setRightCollapsed(false)
      if (!sheetViewport) setLeftCollapsed(false)
    },
    // Mode keys are comparison-only and inert while focused on one source.
    onMode: (next) => {
      if (hasB && focusSlot === null) onModeChange(next)
    },
    onFit: fitAction,
    onCopy: () => copyView(null),
    onExport: () => setExportOpen(true),
    onHelp: () => setHelpOpen((v) => !v),
    onAnnotate: toggleAnnotate,
    onAnnotateDisarm: {
      enabled:
        sheetOpen ||
        (annotateArmed && annotationDraft === null) ||
        measureMode !== 'none',
      disarm: () => {
        // An open sheet owns Escape first — it covers the map.
        if (sheetOpen) return closeSheets()
        disarmAnnotate()
        setMeasureMode('none')
      },
    },
    onPan,
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
  const setOverlayLabel = useCallback(
    (id: string, labelProperty: string | null) =>
      setOverlays((prev) =>
        prev.map((o) => (o.id === id ? { ...o, labelProperty } : o)),
      ),
    [],
  )

  // -------- Source view-model for the map components --------
  const mapSourceA: CompareMapSource = {
    slot: 'a',
    id: a.id,
    baseUrl: a.baseUrl,
    label: a.label,
    layers: sourceA.layers,
    decorationLayers: sourceA.decorationLayers,
    activeOrder: activeOrderA,
    layerOpacities: selection.opacitiesFor('a'),
    resolveTime: resolveTimeA,
    onLoadResult: onLoadResultA,
    timeSteps: rawStepsA,
    layersLoading: sourceA.loadingLayers || sourceA.retrying,
    hiddenAtTime: resolvedA.hidden,
    timeTag: timeTagFor('a'),
    timeLabel:
      resolvedA.epoch !== null
        ? formatStep(new Date(resolvedA.epoch).toISOString())
        : null,
    masterOpacity: globalOpacity * sourceOpacity.a,
    bbox: sourceA.bbox,
  }
  const mapSourceB: CompareMapSource | null = b
    ? {
        slot: 'b',
        id: b.id,
        baseUrl: b.baseUrl,
        label: b.label,
        layers: sourceB.layers,
        decorationLayers: sourceB.decorationLayers,
        activeOrder: activeOrderB,
        layerOpacities: selection.opacitiesFor('b'),
        resolveTime: resolveTimeB,
        onLoadResult: onLoadResultB,
        timeSteps: rawStepsB,
        layersLoading: sourceB.loadingLayers || sourceB.retrying,
        hiddenAtTime: resolvedB.hidden,
        timeTag: timeTagFor('b'),
        timeLabel:
          resolvedB.epoch !== null
            ? formatStep(new Date(resolvedB.epoch).toISOString())
            : null,
        masterOpacity: globalOpacity * sourceOpacity.b,
        bbox: sourceB.bbox,
      }
    : null

  // -------- Capabilities load/error surface --------
  // Only A gates the whole viewer; a failing/loading B must not blank a
  // working solo view.
  if (sourceA.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-6 text-center text-sm">
        <P className="max-w-md text-destructive">{sourceA.error}</P>
        {!isLoopbackUrl(a.baseUrl) && (
          <P className="text-xs text-muted-foreground">{t('panel.corsHint')}</P>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            sourceA.retry()
            if (hasB) sourceB.retry()
          }}
          className="gap-1.5"
        >
          <RefreshCw className="h-3 w-3" />
          {tExec('lens.retry')}
        </Button>
      </div>
    )
  }
  if (sourceA.loadingLayers) {
    return <GeoViewerSkeleton label={tExec('lens.loadingLayers')} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {hasB && sourceB.error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{t('panel.bError')}</span>{' '}
            <span className="text-muted-foreground">{sourceB.error}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              onClick={sourceB.retry}
            >
              <RefreshCw className="h-3 w-3" />
              {tExec('lens.retry')}
            </Button>
            {onRemoveB && (
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={onRemoveB}
              >
                {t('panel.removeB')}
              </Button>
            )}
          </span>
        </div>
      )}
      <GeoToolbar
        solo={!hasB}
        focusSlot={focusSlot}
        onFocusChange={setFocusSlot}
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
        onMeasureMode={setMeasureModeExclusive}
        onMeasureClear={() => setMeasureClearNonce((n) => n + 1)}
        annotateArmed={annotateArmed}
        onAnnotateToggle={toggleAnnotate}
        annotations={annotations}
        onAnnotationsImport={importAnnotations}
        annotationSlotIds={{ a: a.id, b: bId }}
        onExport={() => setExportOpen(true)}
        onCopy={copyView}
        copySlots={hasB}
        basemapId={basemapId}
        onBasemapChange={setBasemapId}
        availableBasemaps={availableBasemaps}
        basemapOpacity={basemapOpacity}
        onBasemapOpacityChange={setBasemapOpacity}
        onHelp={() => setHelpOpen(true)}
      />
      <CompareHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <AlertDialog
        open={leaveBlocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) leaveBlocker.reset?.()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('annotations.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('annotations.leaveBody', { count: annotations.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => downloadAnnotationsGeojson(annotations)}
            >
              {t('annotations.leaveExport')}
            </Button>
            <AlertDialogCancel>{t('annotations.leaveStay')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => leaveBlocker.proceed?.()}>
              {t('annotations.leaveDiscard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AnnotationEditorDialog
        draft={annotationDraft}
        location={annotationDraftLocation}
        onSave={saveAnnotation}
        onDelete={deleteAnnotation}
        onClose={closeAnnotationEditor}
      />
      <GeoExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        capture={captureAction}
        legends={exportLegends}
        annotations={annotations}
        slotIds={{ a: a.id, b: bId }}
        meta={{ labelA: a.label, labelB: b?.label ?? null }}
      />
      <div className="relative flex min-h-0 flex-1 gap-2">
        {/* Collapse hides (not unmounts) the sidebars so working state —
            filter tab, search, level chips, expanded groups — survives
            reopening. Below sm an open sidebar overlays the map instead
            of crushing it. */}
        {sheetOpen && (
          // Modal-sheet scrim: tap closes; also blocks map input beneath.
          <div
            aria-hidden="true"
            data-testid="sidebar-scrim"
            className="absolute inset-0 z-10 bg-black/30 lg:hidden"
            onClick={closeSheets}
          />
        )}
        {leftCollapsed && (
          <CollapsedSidebarHandle side="left" onExpand={expandLeft} />
        )}
        <div
          style={{ display: leftCollapsed ? 'none' : undefined }}
          className="max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:flex max-lg:shadow-xl lg:contents"
        >
          <GeoActiveLayersPanel
            pairs={pairing.pairs}
            selection={selection}
            overlays={{
              items: overlays,
              add: addOverlay,
              toggle: toggleOverlay,
              remove: removeOverlay,
              setLabel: setOverlayLabel,
            }}
            annotations={{
              items: annotations,
              edit: onAnnotationEdit,
              remove: removeAnnotationById,
              locate: locateAnnotation,
              setHighlight: setAnnotationHighlightId,
              attribution: annotationAttribution,
            }}
            opacity={{
              global: globalOpacity,
              setGlobal: setGlobalOpacity,
              source: sourceOpacity,
              setSource: setSourceOpacityFor,
            }}
            preload={{
              enabled: preloadTimeSteps,
              setEnabled: setPreloadTimeSteps,
              available: timeline.epochs.length > 1,
            }}
            pins={{ pinned: pinnedLegends, toggle: togglePinLegend }}
            sources={{
              a: { label: a.label, baseUrl: a.baseUrl, lens: sourceA },
              b: b
                ? { label: b.label, baseUrl: b.baseUrl, lens: sourceB }
                : null,
            }}
            resolution={viewResolution}
            onZoomToResolution={onZoomToResolution}
            focusSlot={focusSlot}
            onCollapse={() => setLeftCollapsed(true)}
          />
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {focusSlot === null && mode === 'side' && mapSourceB ? (
            <DualMapView
              view={viewRef.current}
              a={mapSourceA}
              b={mapSourceB}
              loupeMirror={modeOptions.loupeMirror}
              loupeSizePx={modeOptions.loupeSizePx}
              loupeZoom={modeOptions.loupeZoom}
              loupeLatched={modeOptions.loupeLatched}
              preload={preloadTimeSteps}
              pinnedLegends={pinnedLegendItems}
              onUnpinLegend={unpinLegend}
              measureMode={measureMode}
              measureClearNonce={measureClearNonce}
              overlays={overlays}
              annotations={annotations}
              annotateArmed={annotateArmed}
              annotationHighlightId={annotationHighlightId}
              onAnnotationCreate={onAnnotationCreate}
              onAnnotationEdit={onAnnotationEdit}
              onAnnotationMove={moveAnnotation}
              basemapId={basemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterCapture={onRegisterCapture}
            />
          ) : (
            <SingleMapView
              view={viewRef.current}
              a={mapSourceA}
              b={mapSourceB}
              // Focus masks the other source (via per-slot capture); export capture wins.
              captureOnly={captureOnly ?? focusSlot}
              preload={preloadTimeSteps}
              pinnedLegends={pinnedLegendItems}
              onUnpinLegend={unpinLegend}
              mode={
                focusSlot !== null ? 'blend' : mode === 'side' ? 'swipe' : mode
              }
              options={modeOptions}
              measureMode={measureMode}
              measureClearNonce={measureClearNonce}
              overlays={overlays}
              annotations={annotations}
              annotateArmed={annotateArmed}
              annotationHighlightId={annotationHighlightId}
              onAnnotationCreate={onAnnotationCreate}
              onAnnotationEdit={onAnnotationEdit}
              onAnnotationMove={moveAnnotation}
              basemapId={basemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterCapture={onRegisterCapture}
            />
          )}
        </div>
        <div
          style={{ display: rightCollapsed ? 'none' : undefined }}
          className="max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:flex max-lg:shadow-xl lg:contents"
        >
          <GeoLayerBrowser
            hasB={hasB}
            focusSlot={focusSlot}
            pairs={pairing.pairs}
            selection={selection}
            sourceA={sourceA}
            sourceB={sourceB}
            onCollapse={() => setRightCollapsed(true)}
          />
        </div>
        {rightCollapsed && (
          <CollapsedSidebarHandle side="right" onExpand={expandRight} />
        )}
      </div>
      <GeoTimeSlider
        hasB={hasB}
        soloSlot={focusSlot}
        timeline={displayTimeline}
        failures={trackFailures}
        index={safeStep}
        onChange={onTimeChange}
        linkMode={timeLinkMode}
        onLinkModeChange={setTimeLinkMode}
        offsetMs={offsetMs}
        onOffsetChange={setOffsetMs}
        offsetMeta={offsetMeta}
        clip={timeClip}
        onClipChange={setTimeClip}
        hoverTimes={hoverTimes}
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
