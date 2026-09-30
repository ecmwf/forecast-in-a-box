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
import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  OUTLINE_BASEMAP,
  SKINNYWMS_BASEMAP,
  basemapFitsProjection,
} from '../ol-layers'
import { DEFAULT_PROJECTION_ID } from '../projection-ids'
import {
  PROJECTIONS,
  bandMetres,
  bandResolution,
  carryCamera,
  getViewerProjection,
  viewerProjectionOf,
} from '../projections'
import { GLOBE_ENGINE } from '../globe/engine-entry'
import { globeBasemapSpec } from '../globe/globe-layer-specs'
import { LazyGlobeView } from '../globe/LazyGlobeView'
import { globeStartCamera, useGlobeViewer } from '../globe/useGlobeViewer'
import {
  activeLayersBbox,
  isLensProxyUrl,
  rebaseLensUrl,
  resolveStyle,
  skinnyWmsBasemap,
  supportsCrs,
  unionBbox,
} from '../wms-capabilities'
import { StartupStatusPill } from '../components/StartupStatusPill'
import { beforeRunLayers, effectiveRuns, mergeEpochLayers } from './run-window'
import { GeoPanelResizeStrip } from './GeoPanelResizeStrip'
import { useGeoPanelWidths } from './useGeoPanelWidths'
import { buildPairs } from './layer-pairing'
import { useCompareSelection } from './useCompareSelection'
import { useGetMapFailureLog } from './getmap-failures'
import { GeoToolbar } from './GeoToolbar'
import { GeoExportDialog } from './GeoExportDialog'
import { AnnotationEditorDialog } from './AnnotationEditorDialog'
import { useViewerAnnotations } from './useViewerAnnotations'
import { useViewerUrlState } from './useViewerUrlState'
import { useViewerExport } from './useViewerExport'
import { useViewerTimeline } from './useViewerTimeline'
import { downloadAnnotationsGeojson } from './annotations'
import { useGeoShortcuts } from './useGeoShortcuts'
import { panView, zoomView } from './map-nav'
import { GeoTimeSlider } from './GeoTimeSlider'
import { GeoActiveLayersPanel } from './GeoActiveLayersPanel'
import { GeoLayerBrowser } from './GeoLayerBrowser'
import { DualMapView } from './DualMapView'
import { SingleMapView } from './SingleMapView'
import type { TFunction } from 'i18next'
import type {
  Bbox,
  LayerRequestSettings,
  ParsedLayer,
} from '../wms-capabilities'
import type { GeoPanelSide } from './useGeoPanelWidths'
import type { MapAnnotation } from './annotations'
import type { ContextOverlay } from './overlays'
import type View from 'ol/View'
import type { FlatProjectionId } from '../projection-ids'
import type { BboxAxisOrder } from '../projections'
import type { ProjectionOption } from './GeoToolbar'
import type { SourceSlot } from './layer-pairing'
import type {
  CompareMapSource,
  CompareMode,
  CompareModeOptions,
  FitBboxAction,
} from './types'
import type { MeasureMode } from '../hooks/useMeasure'
import type { ViewerUrlState } from './view-url-state'
import { CollapsedSidebarHandle } from '@/components/common/CollapsedSidebarHandle'
import { TOUR, tourAttr } from '@/features/tutorials/anchors'
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
import { showToast } from '@/lib/toast'
import {
  stylePinKey,
  styleScope,
  useStylePinsStore,
} from '@/stores/stylePinsStore'
import { preloadOutlineData } from '@/lib/map/ol-outline'
import { useUiStore } from '@/stores/uiStore'

export interface GeoViewerSource {
  /** Stable source identity (basket entry ref) — annotations bind to it. */
  id: string
  baseUrl: string
  label: string
  /** When the run was submitted ("14 Sep 06:23"); shown after the label. */
  submittedAt?: string | null
  /** External server's BBOX axis order; lens sources are always 'xy'. */
  bboxAxisOrder?: BboxAxisOrder
}

/** Effect-dep key of a slot's dimension choices. */
function runsKey(settings: ReadonlyMap<string, LayerRequestSettings>): string {
  return [...settings]
    .flatMap(([name, s]) =>
      s.dims ? [`${name}=${JSON.stringify(s.dims)}`] : [],
    )
    .join(',')
}

/** Lens-proxy answers carry a meaning of their own (backend #712). */
function lensProxyErrorText(
  source: { error: string | null; errorStatus: number | null },
  baseUrl: string,
  t: TFunction<'visualise'>,
): string | null {
  if (!source.error) return null
  if (!isLensProxyUrl(baseUrl)) return source.error
  switch (source.errorStatus) {
    case 500:
      return t('lens.failed')
    case 404:
      return t('lens.gone')
    case 400:
      return t('lens.unproxyable')
    default:
      return source.error
  }
}

export function GeoViewer({
  a,
  b = null,
  mode,
  onModeChange,
  onRemoveB,
  onHelp,
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
  /** Toggle the page-owned help dialog (H, always-present page button). */
  onHelp: () => void
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

  // A globe restore needs hardware WebGL; otherwise the view starts flat.
  const [globeStart] = useState(() => globeStartCamera(initialViewRef.current))
  const startOnGlobe = globeStart !== null

  // One View per flat projection (camera carried); kept while on the globe.
  const [view, setView] = useState<View>(() => {
    const restored = initialViewRef.current?.projection
    const projection = getViewerProjection(
      restored === 'globe' ? DEFAULT_PROJECTION_ID : restored,
    )
    const next = createViewerView(projection)
    const cam = initialViewRef.current?.camera
    if (cam && !startOnGlobe) {
      next.setCenter(fromLonLat([cam.lon, cam.lat], projection.code))
      next.setZoom(cam.zoom)
      // A restored camera outranks the initial auto-fit.
      next.set(AUTOFIT_KEY, true, true)
    }
    return next
  })
  // Warm the Outline basemap data so a projection switch is instant.
  useEffect(() => preloadOutlineData(), [])
  // Imperative users (pan, zoom, locate) read the live instance.
  const viewRef = useRef(view)
  viewRef.current = view
  const projection = viewerProjectionOf(view)
  const flatId = projection.id
  const adoptFlatView = useCallback((next: View) => {
    viewRef.current = next
    setView(next)
  }, [])
  const changeFlatProjection = useCallback(
    (id: FlatProjectionId) => {
      const current = viewRef.current
      const target = getViewerProjection(id)
      if (current.getProjection().getCode() === target.code) return
      const next = createViewerView(target)
      carryCamera(current, next, target)
      next.set(AUTOFIT_KEY, true, true)
      adoptFlatView(next)
    },
    [adoptFlatView],
  )

  // Source focus: a slot views only that source (UI collapses to it); null compares both.
  const [focusSlot, setFocusSlot] = useState<SourceSlot | null>(null)

  // -------- 3D globe (flat <-> globe handoff) --------
  const globe = useGlobeViewer({
    viewRef,
    adoptFlatView,
    changeFlatProjection,
    flatId,
    initialProjection: initialViewRef.current?.projection,
    initialCamera: globeStart,
    hasB,
    focusSlot,
    mode,
  })
  const { projectionId, changeProjection } = globe

  // -------- Pairing + selection --------
  const pairing = useMemo(
    () => buildPairs(sourceA.groups, sourceB.groups),
    [sourceA.groups, sourceB.groups],
  )
  // Pinned default styles: seed newly activated layers (URL styles win).
  const stylePins = useStylePinsStore((s) => s.pins)
  const pinStyle = useStylePinsStore((s) => s.pin)
  const unpinStyle = useStylePinsStore((s) => s.unpin)
  const bBase = b?.baseUrl ?? null
  const scopeFor = useCallback(
    (slot: SourceSlot) => {
      const base = slot === 'a' ? a.baseUrl : bBase
      return base === null ? null : styleScope(base)
    },
    [a.baseUrl, bBase],
  )
  const defaultStyle = useCallback(
    (slot: SourceSlot, layerName: string) => {
      const scope = scopeFor(slot)
      return scope ? (stylePins[stylePinKey(scope, layerName)] ?? null) : null
    },
    [scopeFor, stylePins],
  )
  const selection = useCompareSelection(pairing.pairs, { defaultStyle })
  const stylePinControls = useMemo(
    () => ({
      pinnedFor: defaultStyle,
      setPin: (slot: SourceSlot, layerName: string, style: string | null) => {
        const scope = scopeFor(slot)
        if (!scope) return
        if (style) pinStyle(scope, layerName, style)
        else unpinStyle(scope, layerName)
      },
    }),
    [defaultStyle, scopeFor, pinStyle, unpinStyle],
  )

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
  const settingsA = selection.settingsFor('a')
  const settingsB = selection.settingsFor('b')

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
  // A run change serves different instants — same rule.
  const runsKeyA = useMemo(() => runsKey(settingsA), [settingsA])
  const runsKeyB = useMemo(() => runsKey(settingsB), [settingsB])
  useEffect(
    () => clearFailures('a'),
    [clearFailures, a.baseUrl, sourceA.layers, runsKeyA],
  )
  useEffect(
    () => clearFailures('b'),
    [clearFailures, b?.baseUrl, sourceB.layers, runsKeyB],
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
  // Steps before a pinned run are known failures.
  const timelineFailures = useMemo(
    () => ({
      a: mergeEpochLayers(
        failures.failedLayers.a,
        beforeRunLayers(sourceA.layers, activeOrderA, settingsA),
      ),
      b: mergeEpochLayers(
        failures.failedLayers.b,
        beforeRunLayers(sourceB.layers, activeOrderB, settingsB),
      ),
    }),
    [
      failures.failedLayers,
      sourceA.layers,
      sourceB.layers,
      activeOrderA,
      activeOrderB,
      settingsA,
      settingsB,
    ],
  )

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
    onSourceReplaced,
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
    failedLayers: timelineFailures,
  })

  // -------- Fit plumbing (map components register their fit action) ----
  const [fitAction, setFitAction] = useState<(() => void) | null>(null)
  const onRegisterFit = useCallback(
    (fit: (() => void) | null) => setFitAction(() => fit),
    [],
  )
  const [fitBboxAction, setFitBboxAction] = useState<FitBboxAction | null>(null)
  const onRegisterFitBbox = useCallback(
    (fit: FitBboxAction | null) => setFitBboxAction(() => fit),
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
    return [
      ...BASEMAPS,
      OUTLINE_BASEMAP,
      ...(hasSkinny ? [SKINNYWMS_BASEMAP] : []),
    ]
  }, [sourceA.decorationLayers])
  // Snap back when a swap drops the option — after A settles (restored SkinnyWMS).
  useEffect(() => {
    if (sourceA.loadingLayers) return
    if (!availableBasemaps.some((opt) => opt.id === basemapId)) {
      setBasemapId(DEFAULT_BASEMAP_ID)
    }
  }, [availableBasemaps, basemapId, sourceA.loadingLayers])
  // Where the choice cannot be drawn the Outline stands in; the choice is kept.
  const onGlobe = projectionId === 'globe'
  const effectiveBasemapId = useMemo(() => {
    const opt = availableBasemaps.find((o) => o.id === basemapId)
    // Every offered basemap draws on the globe.
    const fits = !opt || onGlobe || basemapFitsProjection(opt, projection)
    return fits ? basemapId : OUTLINE_BASEMAP.id
  }, [availableBasemaps, basemapId, projection, onGlobe])
  // Under a handoff the flat map matches the globe's first frame: Carto only from Mercator.
  const flatBasemapId =
    globe.phase === 'flat' || flatId === 'merc'
      ? effectiveBasemapId
      : OUTLINE_BASEMAP.id

  // Offered only when every loaded source advertises the CRS.
  const projectionOptions = useMemo<ReadonlyArray<ProjectionOption>>(() => {
    const sources = [
      { src: sourceA, label: `A · ${a.label}` },
      ...(b ? [{ src: sourceB, label: `B · ${b.label}` }] : []),
    ]
    const lacking = (code: string) =>
      sources.find(
        ({ src }) =>
          !src.loadingLayers &&
          src.error === null &&
          !supportsCrs(src.crs, code),
      )?.label ?? null
    const flat: Array<ProjectionOption> = PROJECTIONS.map((p) => ({
      id: p.id,
      labelKey: p.labelKey,
      // Mercator is never blocked: every server answers it in practice.
      blockedBy: p.id === DEFAULT_PROJECTION_ID ? null : lacking(p.code),
    }))
    if (!globe.available) return flat
    // The globe shows one source, or two side by side.
    const crsBlock = lacking(GLOBE_ENGINE.requiredCrs)
    const modeBlock = hasB && focusSlot === null && mode !== 'side'
    return [
      ...flat,
      {
        id: 'globe',
        labelKey: 'projections.globe',
        blockedBy:
          crsBlock ?? (modeBlock ? t('projections.blockedMode') : null),
        blockedReason: crsBlock ? 'crs' : modeBlock ? 'mode' : undefined,
      },
    ]
    // Keyed on the meaningful bits — the source objects churn every render.
  }, [
    sourceA.crs,
    sourceA.loadingLayers,
    sourceA.error,
    sourceB.crs,
    sourceB.loadingLayers,
    sourceB.error,
    a.label,
    b,
    globe.available,
    hasB,
    focusSlot,
    mode,
    t,
  ])
  // Snap back when a source lacks the CRS or the layout cannot show the globe.
  const { leave: leaveGlobe, exitTarget: globeExitTarget } = globe
  useEffect(() => {
    if (projectionId === 'globe') {
      if (globe.phase !== 'globe') return
      const current = projectionOptions.find((p) => p.id === 'globe')
      if (!current) return leaveGlobe(DEFAULT_PROJECTION_ID, true)
      if (!current.blockedBy) return
      if (current.blockedReason === 'mode') {
        showToast.info(t('projections.snappedBackMode'))
        return leaveGlobe(globeExitTarget)
      }
      showToast.info(
        t('projections.snappedBack', {
          source: current.blockedBy,
          projection: t(current.labelKey),
        }),
      )
      return leaveGlobe(DEFAULT_PROJECTION_ID)
    }
    const current = projectionOptions.find((p) => p.id === projectionId)
    if (!current?.blockedBy) return
    showToast.info(
      t('projections.snappedBack', {
        source: current.blockedBy,
        projection: t(current.labelKey),
      }),
    )
    changeProjection(DEFAULT_PROJECTION_ID)
  }, [
    projectionOptions,
    projectionId,
    changeProjection,
    t,
    globe.phase,
    leaveGlobe,
    globeExitTarget,
  ])
  const cycleProjection = useCallback(() => {
    const open = projectionOptions.filter((p) => p.blockedBy === null)
    const idx = open.findIndex((p) => p.id === projectionId)
    const next = open.at((idx + 1) % open.length)
    if (next) changeProjection(next.id)
  }, [projectionOptions, projectionId, changeProjection])

  // -------- URL view-state restore + report --------
  useViewerUrlState({
    initial: initialViewRef.current,
    onViewStateChange,
    view,
    projectionId,
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
    globeCamera: globe.phase === 'globe' ? globe.camera : null,
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
      const legendUrl = layer
        ? resolveStyle(layer, selection.settingsFor(slot).get(name)?.style)
            ?.legendUrl
        : undefined
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
    settingsA,
    settingsB,
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

  // Swap: slot-keyed state follows the content. Replacement: pair-tuned
  // time linking resets (re-adding the SAME B keeps its settings).
  const prevIdsRef = useRef<{ a: string; b: string | null }>({
    a: a.id,
    b: bId,
  })
  const lastBIdRef = useRef<string | null>(bId)
  const swapSelectionSlots = selection.onSlotsSwapped
  useEffect(() => {
    const prev = prevIdsRef.current
    prevIdsRef.current = { a: a.id, b: bId }
    const lastB = lastBIdRef.current
    if (bId !== null) lastBIdRef.current = bId
    if (prev.a === bId && prev.b === a.id && a.id !== bId) {
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
      return
    }
    if (prev.a !== a.id) onSourceReplaced('a')
    if (bId !== null && lastB !== null && bId !== lastB) onSourceReplaced('b')
  }, [a.id, bId, swapSelectionSlots, onSlotsSwapped, onSourceReplaced])

  // Prune unserved unlinked names once a catalog settles healthy (absent B
  // keeps its list). Declared after the swap detector — remap lands first.
  const retainServable = selection.retainServable
  useEffect(() => {
    if (sourceA.loadingLayers || sourceA.retrying || sourceA.error) return
    retainServable('a', new Set(sourceA.layers.map((l) => l.name)))
  }, [
    retainServable,
    sourceA.loadingLayers,
    sourceA.retrying,
    sourceA.error,
    sourceA.layers,
  ])
  useEffect(() => {
    if (!hasB || sourceB.loadingLayers || sourceB.retrying || sourceB.error)
      return
    retainServable('b', new Set(sourceB.layers.map((l) => l.name)))
  }, [
    retainServable,
    hasB,
    sourceB.loadingLayers,
    sourceB.retrying,
    sourceB.error,
    sourceB.layers,
  ])

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

  // lg+ sidebar widths (persisted); the strips drag against live DOM width.
  const {
    widths: panelWidths,
    styleVars: panelStyleVars,
    setSide: setPanelWidth,
  } = useGeoPanelWidths()
  const panelsRef = useRef<HTMLDivElement>(null)
  const measurePanel = useCallback((side: GeoPanelSide) => {
    const el = panelsRef.current?.querySelector<HTMLElement>(
      `[data-geo-panel="${side}"]`,
    )
    return el?.offsetWidth ?? 288
  }, [])
  const expandLeft = () => {
    setLeftCollapsed(false)
    if (sheetViewport) setRightCollapsed(true)
  }
  const expandRight = () => {
    setRightCollapsed(false)
    if (sheetViewport) setLeftCollapsed(true)
  }
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
  // Map-click tools have no globe counterpart.
  useEffect(() => {
    if (globe.phase === 'flat') return
    disarmAnnotate()
    setMeasureMode('none')
  }, [globe.phase, disarmAnnotate])
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
  const {
    pan: panGlobe,
    zoomBy: zoomGlobe,
    zoomToResolution: zoomGlobeToResolution,
  } = globe
  const onPan = useCallback(
    (dx: number, dy: number) => {
      if (!panGlobe(dx, dy)) panView(viewRef.current, dx, dy)
    },
    [panGlobe],
  )
  const onZoom = useCallback(
    (delta: number) => {
      if (!zoomGlobe(delta)) zoomView(viewRef.current, delta)
    },
    [zoomGlobe],
  )

  // Live ground resolution (m/px) drives the panel's scale-band hints.
  const [flatResolution, setFlatResolution] = useState<number | null>(null)
  const globeSettled = globe.phase === 'globe'
  useEffect(() => {
    if (globeSettled) return
    const update = () => setFlatResolution(bandMetres(view))
    update()
    view.on('change:resolution', update)
    return () => view.un('change:resolution', update)
  }, [view, globeSettled])
  const viewResolution = globe.resolution ?? flatResolution
  const onZoomToResolution = useCallback(
    (res: number) => {
      if (zoomGlobeToResolution(res)) return
      const current = viewRef.current
      current.animate({
        resolution: bandResolution(current, res),
        duration: 350,
      })
    },
    [zoomGlobeToResolution],
  )

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
    settingsA,
    settingsB,
    annotations,
    slotIds: { a: a.id, b: bId },
  })

  useGeoShortcuts({
    onProjectionCycle: cycleProjection,
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
    onHelp,
    // Map-click tools have no globe counterpart.
    onAnnotate: () => {
      if (globe.phase === 'flat') toggleAnnotate()
    },
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
    onZoom,
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

  const runLabelFor = (
    layers: ReadonlyArray<ParsedLayer>,
    order: ReadonlyArray<string>,
    settings: ReadonlyMap<string, LayerRequestSettings>,
  ): string | null => {
    const runs = effectiveRuns(layers, order, settings)
    if (runs.length === 0) return null
    return runs.length === 1
      ? t('slotTag.run', { time: formatStep(runs[0]) })
      : t('slotTag.runCount', { count: runs.length })
  }

  // Fit target: active layers of both sides, else A's service coverage.
  const fitBbox = useMemo(() => {
    const sideBbox = (
      layers: ReadonlyArray<ParsedLayer>,
      order: ReadonlyArray<string>,
      service: Bbox | null,
    ) =>
      order.length > 0 ? (activeLayersBbox(layers, order) ?? service) : null
    return (
      unionBbox(
        sideBbox(sourceA.layers, activeOrderA, sourceA.bbox),
        sideBbox(sourceB.layers, activeOrderB, sourceB.bbox),
      ) ?? sourceA.bbox
    )
  }, [
    sourceA.layers,
    sourceA.bbox,
    sourceB.layers,
    sourceB.bbox,
    activeOrderA,
    activeOrderB,
  ])

  // -------- Source view-model for the map components --------
  const mapSourceA: CompareMapSource = {
    slot: 'a',
    id: a.id,
    baseUrl: a.baseUrl,
    label: a.label,
    submittedAt: a.submittedAt ?? null,
    layers: sourceA.layers,
    decorationLayers: sourceA.decorationLayers,
    activeOrder: activeOrderA,
    layerOpacities: selection.opacitiesFor('a'),
    layerSettings: selection.settingsFor('a'),
    bboxAxisOrder: isLensProxyUrl(a.baseUrl)
      ? 'xy'
      : (a.bboxAxisOrder ?? 'epsg'),
    maxImageSize: sourceA.maxImageSize,
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
    runLabel: runLabelFor(sourceA.layers, activeOrderA, settingsA),
    masterOpacity: globalOpacity * sourceOpacity.a,
    bbox: fitBbox,
  }
  const mapSourceB: CompareMapSource | null = b
    ? {
        slot: 'b',
        id: b.id,
        baseUrl: b.baseUrl,
        label: b.label,
        submittedAt: b.submittedAt ?? null,
        layers: sourceB.layers,
        decorationLayers: sourceB.decorationLayers,
        activeOrder: activeOrderB,
        layerOpacities: selection.opacitiesFor('b'),
        layerSettings: selection.settingsFor('b'),
        bboxAxisOrder: isLensProxyUrl(b.baseUrl)
          ? 'xy'
          : (b.bboxAxisOrder ?? 'epsg'),
        maxImageSize: sourceB.maxImageSize,
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
        runLabel: runLabelFor(sourceB.layers, activeOrderB, settingsB),
        masterOpacity: globalOpacity * sourceOpacity.b,
        bbox: fitBbox,
      }
    : null

  // -------- Globe wiring --------
  const resolvedTheme = useUiStore((s) => s.resolvedTheme)
  // The choice itself, not the flat fallback: a warm globe must not switch style mid-bend.
  const globeBasemap = useMemo(
    () =>
      globeBasemapSpec(
        availableBasemaps.find((o) => o.id === basemapId),
        resolvedTheme,
        basemapOpacity,
      ),
    [availableBasemaps, basemapId, resolvedTheme, basemapOpacity],
  )
  const globeOffered =
    projectionOptions.find((p) => p.id === 'globe')?.blockedBy === null

  // -------- Capabilities load/error surface --------
  // Only A gates the whole viewer; a failing/loading B must not blank a
  // working solo view.
  if (sourceA.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-6 text-center text-sm">
        <P className="max-w-md text-danger">
          {lensProxyErrorText(sourceA, a.baseUrl, t)}
        </P>
        {!isLensProxyUrl(a.baseUrl) && (
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
  // While A's catalogue loads, render the real shell with a status pill.
  const startup = sourceA.loadingLayers
    ? isLensProxyUrl(a.baseUrl)
      ? {
          steps: [
            { id: 'server', label: t('startup.server') },
            { id: 'files', label: t('startup.files') },
            { id: 'catalogue', label: t('startup.catalogue') },
          ],
          // Capabilities failing = SkinnyWMS still booting / reading GRIBs.
          activeIndex: sourceA.retrying ? 1 : 2,
          hint: t('startup.firstStartHint'),
        }
      : {
          steps: [
            { id: 'connect', label: t('startup.connect') },
            { id: 'catalogue', label: t('startup.catalogue') },
          ],
          activeIndex: sourceA.retrying ? 0 : 1,
        }
    : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {hasB && sourceB.error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{t('panel.bError')}</span>{' '}
            <span className="text-muted-foreground">
              {lensProxyErrorText(sourceB, b.baseUrl, t)}
            </span>
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
        basemapId={effectiveBasemapId}
        onBasemapChange={setBasemapId}
        availableBasemaps={availableBasemaps}
        projection={projection}
        projectionId={projectionId}
        projections={projectionOptions}
        onProjectionChange={changeProjection}
        globeActive={globe.phase !== 'flat'}
        onGlobeIntent={globeOffered ? globe.warmUp : undefined}
        basemapOpacity={basemapOpacity}
        onBasemapOpacityChange={setBasemapOpacity}
      />
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
      <div
        ref={panelsRef}
        style={panelStyleVars}
        className="relative flex min-h-0 flex-1 gap-2"
      >
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
          <CollapsedSidebarHandle
            side="left"
            onExpand={expandLeft}
            buttonAttrs={tourAttr(TOUR.visualise.expandLeft)}
          />
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
            stylePins={stylePinControls}
            sources={{
              a: {
                label: a.label,
                baseUrl: a.baseUrl,
                lens: sourceA,
                resolveTime: resolveTimeA,
                bboxAxisOrder: mapSourceA.bboxAxisOrder,
              },
              b:
                b && mapSourceB
                  ? {
                      label: b.label,
                      baseUrl: b.baseUrl,
                      lens: sourceB,
                      resolveTime: resolveTimeB,
                      bboxAxisOrder: mapSourceB.bboxAxisOrder,
                    }
                  : null,
            }}
            resolution={viewResolution}
            onZoomToResolution={onZoomToResolution}
            onZoomToBbox={fitBboxAction}
            previewView={view}
            focusSlot={focusSlot}
            onCollapse={() => setLeftCollapsed(true)}
          />
        </div>
        {!leftCollapsed && (
          <GeoPanelResizeStrip
            side="left"
            valueNow={panelWidths.left ?? 288}
            getWidth={() => measurePanel('left')}
            onWidth={(px) => setPanelWidth('left', px)}
            onReset={() => setPanelWidth('left', null)}
          />
        )}
        <div
          ref={globe.mapAreaRef}
          className="relative min-h-0 min-w-0 flex-1"
          {...tourAttr(TOUR.visualise.map)}
        >
          {startup && <StartupStatusPill {...startup} />}
          {(globe.phase !== 'flat' || (globe.warm && globeOffered)) && (
            <LazyGlobeView
              layout={globe.panels === 2 ? 'side' : 'single'}
              sources={
                globe.panels === 2 && mapSourceB
                  ? [mapSourceA, mapSourceB]
                  : [focusSlot === 'b' && mapSourceB ? mapSourceB : mapSourceA]
              }
              camera={globe.camera}
              visible={globe.overlayVisible}
              active={globe.phase === 'globe'}
              live={globe.phase !== 'flat'}
              basemap={globeBasemap}
              loupe={{
                sizePx: modeOptions.loupeSizePx,
                zoom: modeOptions.loupeZoom,
                latched: modeOptions.loupeLatched,
                mirror: modeOptions.loupeMirror,
              }}
              pinnedLegends={pinnedLegendItems}
              onUnpinLegend={unpinLegend}
              registerEngine={globe.registerEngine}
              onFailure={globe.onFailure}
              onContextLost={globe.onContextLost}
              onRegisterFit={onRegisterFit}
              onRegisterFitBbox={onRegisterFitBbox}
              onZoom={zoomGlobe}
              onRegisterCapture={onRegisterCapture}
            />
          )}
          {globe.phase === 'globe' ? null : focusSlot === null &&
            mode === 'side' &&
            mapSourceB ? (
            <DualMapView
              view={view}
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
              basemapId={flatBasemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterFitBbox={onRegisterFitBbox}
              onRegisterCapture={onRegisterCapture}
            />
          ) : (
            <SingleMapView
              view={view}
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
              basemapId={flatBasemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterFitBbox={onRegisterFitBbox}
              onRegisterCapture={onRegisterCapture}
            />
          )}
        </div>
        {!rightCollapsed && (
          <GeoPanelResizeStrip
            side="right"
            valueNow={panelWidths.right ?? 288}
            getWidth={() => measurePanel('right')}
            onWidth={(px) => setPanelWidth('right', px)}
            onReset={() => setPanelWidth('right', null)}
          />
        )}
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
          <CollapsedSidebarHandle
            side="right"
            onExpand={expandRight}
            buttonAttrs={tourAttr(TOUR.visualise.expandRight)}
          />
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
