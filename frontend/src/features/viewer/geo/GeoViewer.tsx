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
 * Owns: per-source capabilities (useLensSource ×2), the pairing/selection
 * model (linked by default, auto-unlinks on zero overlap), the shared
 * epoch-keyed valid-time timeline, one persistent `ol/View` (camera
 * survives mode switches — maps remount, the View doesn't), and the mode
 * toolbar. Map mechanics live in SingleMapView / DualMapView.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import 'ol/ol.css'
import { Loader2, RefreshCw } from 'lucide-react'
import { useLensSource } from '../hooks/useLensSource'
import { createViewerView } from '../hooks/useOlMapBase'
import { formatStep } from '../format'
import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  IMAGERY_BASEMAPS,
  SKINNYWMS_BASEMAP,
} from '../ol-layers'
import { rebaseLensUrl, skinnyWmsBasemap } from '../wms-capabilities'
import { canvasToPngBlob, joinCanvasesHorizontally } from '../map-export'
import { CollapsedSidebarHandle } from '../components/CollapsedSidebarHandle'
import { composeCaptures } from './export-pipeline'
import { buildPairs } from './layer-pairing'
import {
  buildCompareTimeline,
  buildSourceTimeIndex,
  locateEpoch,
} from './compare-timeline'
import { useCompareSelection } from './useCompareSelection'
import {
  defaultToleranceMs,
  effectiveAvailability,
  effectiveFailures,
  formatOffset,
  medianStepMs,
  offsetBounds,
  resolveSourceTime,
} from './time-link'
import { useGetMapFailureLog } from './getmap-failures'
import { GeoToolbar } from './GeoToolbar'
import { GeoExportDialog } from './GeoExportDialog'
import { CompareHelpDialog } from './CompareHelpDialog'
import { AnnotationEditorDialog } from './AnnotationEditorDialog'
import { nextAnnotationId } from './annotations'
import { useGeoShortcuts } from './useGeoShortcuts'
import { GeoTimeSlider } from './GeoTimeSlider'
import { GeoActiveLayersPanel } from './GeoActiveLayersPanel'
import { GeoLayerBrowser } from './GeoLayerBrowser'
import { DualMapView } from './DualMapView'
import { SingleMapView } from './SingleMapView'
import type { MapAnnotation } from './annotations'
import type { AnnotationDraft } from './AnnotationEditorDialog'
import type { ContextOverlay } from './overlays'
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
import { copyToClipboard } from '@/lib/clipboard'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'

const log = createLogger('GeoViewer')

export interface GeoViewerSource {
  baseUrl: string
  label: string
}

export function GeoViewer({
  a,
  b = null,
  mode,
  onModeChange,
  onRequestAddSource,
  onRemoveB,
}: {
  a: GeoViewerSource
  /** Second source; null runs the viewer solo. */
  b?: GeoViewerSource | null
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  /** Solo-mode "Compare…" CTA in the toolbar. */
  onRequestAddSource?: () => void
  /** Clear slot B (offered when B fails). */
  onRemoveB?: () => void
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')

  const hasB = b !== null
  const sourceA = useLensSource(a.baseUrl)
  const sourceB = useLensSource(b?.baseUrl ?? null)

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
  // Raw per-source step strings, epoch-ordered (prefetch warmup).
  const rawStepsA = useMemo(
    () =>
      timeIndexA.epochs.flatMap((e) => {
        const raw = timeIndexA.rawByEpoch.get(e)
        return raw !== undefined ? [raw] : []
      }),
    [timeIndexA],
  )
  const rawStepsB = useMemo(
    () =>
      timeIndexB.epochs.flatMap((e) => {
        const raw = timeIndexB.rawByEpoch.get(e)
        return raw !== undefined ? [raw] : []
      }),
    [timeIndexB],
  )
  const [timeStep, setTimeStep] = useState(0)
  // Focus window over the union axis (indices into timeline.epochs).
  const [timeClip, setTimeClip] = useState<[number, number] | null>(null)
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

  // Drop a stale clip when the union changes shape under it.
  useEffect(() => {
    if (timeClip && timeClip[1] > timeline.epochs.length - 1) setTimeClip(null)
  }, [timeClip, timeline.epochs.length])

  const clipStart = timeClip ? timeClip[0] : 0
  const clipEnd = timeClip ? timeClip[1] : timeline.epochs.length - 1
  const safeStep = Math.max(
    Math.max(0, clipStart),
    Math.min(timeStep, Math.min(timeline.epochs.length - 1, clipEnd)),
  )
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
  // From the RAW indexes — displayTimeline already shifts B by Δ, so
  // deriving bounds from it would feed back on itself.
  const offsetMeta = useMemo(() => {
    const [minMs, maxMs] = offsetBounds(timeIndexA, timeIndexB)
    const epochsA = timeIndexA.epochs
    const epochsB = timeIndexB.epochs
    const empty = epochsA.length === 0 || epochsB.length === 0
    return {
      minMs,
      maxMs,
      stepMs: Math.min(medianStepMs(timeIndexA), medianStepMs(timeIndexB)),
      alignStartsMs: empty ? null : epochsB[0] - epochsA[0],
      alignEndsMs: empty
        ? null
        : epochsB[epochsB.length - 1] - epochsA[epochsA.length - 1],
    }
  }, [timeIndexA, timeIndexB])
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

  // Per-side hover instants for the timeline tooltip: what each side
  // would display if the slider stood at the hovered epoch.
  const hoverTimes = useCallback(
    (epoch: number) => {
      if (timeLinkMode === 'exact' || timeLinkMode === 'independent') {
        return null
      }
      const ra = resolveSourceTime(
        timeIndexA,
        epoch,
        'nearest',
        defaultToleranceMs(timeIndexA),
      )
      const rb = resolveSourceTime(
        timeIndexB,
        timeLinkMode === 'offset' ? epoch + offsetMs : epoch,
        'nearest',
        defaultToleranceMs(timeIndexB),
      )
      const label = (e: number | null) =>
        e !== null ? formatStep(new Date(e).toISOString()) : null
      return { a: label(ra.epoch), b: label(rb.epoch) }
    },
    [timeLinkMode, timeIndexA, timeIndexB, offsetMs],
  )

  // Tracks (and the A/B/A∩B window presets) show what each side WOULD
  // render at every axis position under the current time-link policy —
  // under a +48h offset, B's usable window visibly shifts off the tail.
  const displayTimeline = useMemo(() => {
    if (timeLinkMode === 'exact' || timeLinkMode === 'independent') {
      return timeline
    }
    return {
      ...timeline,
      availability: {
        a: effectiveAvailability(
          timeline.epochs,
          timeIndexA,
          'nearest',
          0,
          defaultToleranceMs(timeIndexA),
        ),
        b: effectiveAvailability(
          timeline.epochs,
          timeIndexB,
          'nearest',
          timeLinkMode === 'offset' ? offsetMs : 0,
          defaultToleranceMs(timeIndexB),
        ),
      },
    }
  }, [timeline, timeIndexA, timeIndexB, timeLinkMode, offsetMs])

  // Stable per-slot identities: these feed effect deps in the layer
  // stacks, where a fresh closure per render would reconcile every render.
  const resolveTimeA = useMemo(
    () =>
      (layer: ParsedLayer): string | null =>
        layer.time ? resolvedA.raw : null,
    [resolvedA],
  )
  const resolveTimeB = useMemo(
    () =>
      (layer: ParsedLayer): string | null =>
        layer.time ? resolvedB.raw : null,
    [resolvedB],
  )

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
  // Marks projected onto the shared axis exactly like availability, so a
  // mark paints where the failing instant is actually displayed.
  const trackFailures = useMemo(() => {
    const resolveMode =
      timeLinkMode === 'nearest' || timeLinkMode === 'offset'
        ? ('nearest' as const)
        : ('exact' as const)
    return {
      a: effectiveFailures(
        timeline.epochs,
        timeIndexA,
        failures.failedEpochs.a,
        resolveMode,
        0,
        defaultToleranceMs(timeIndexA),
      ),
      b: effectiveFailures(
        timeline.epochs,
        timeIndexB,
        failures.failedEpochs.b,
        resolveMode,
        timeLinkMode === 'offset' ? offsetMs : 0,
        defaultToleranceMs(timeIndexB),
      ),
    }
  }, [
    timeline.epochs,
    timeIndexA,
    timeIndexB,
    failures.failedEpochs,
    timeLinkMode,
    offsetMs,
  ])

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

  // Per-slot copy re-renders the single map with only that slot showing;
  // side-by-side just filters its per-map captures.
  const [captureOnly, setCaptureOnly] = useState<SourceSlot | null>(null)
  const captureFor = async (
    only: SourceSlot | null,
  ): Promise<Array<CaptureResult>> => {
    if (!captureAction) throw new Error('Capture unavailable')
    if (only === null) return captureAction()
    setCaptureOnly(only)
    try {
      // Two frames: React commit, then OL applies the opacity change.
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      )
      const results = await captureAction()
      return results.filter((c) => c.slot === only)
    } finally {
      setCaptureOnly(null)
    }
  }

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

  // Active layers' legends for the export (per slot, lens URLs rebased,
  // external URLs verbatim — rebaseLensUrl handles both).
  const bBaseUrl = b?.baseUrl ?? null
  const exportLegends = useMemo(() => {
    const specs: Array<{ slot: SourceSlot; title: string; url: string }> = []
    const slots: Array<
      readonly [SourceSlot, typeof sourceA, string, ReadonlyArray<string>]
    > = [['a', sourceA, a.baseUrl, activeOrderA]]
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
  }, [sourceA, sourceB, a.baseUrl, bBaseUrl, activeOrderA, activeOrderB])

  // Basemap — one choice driving every panel, embedded-viewer options.
  const [basemapId, setBasemapId] = useState<string>(DEFAULT_BASEMAP_ID)
  const [basemapOpacity, setBasemapOpacity] = useState(1)
  const availableBasemaps = useMemo(() => {
    // SkinnyWMS native background comes from A's lens (the canvas host in
    // single-map modes); dual panels fall back per-side when B lacks one.
    const hasSkinny =
      skinnyWmsBasemap(sourceA.decorationLayers).background !== null
    return [
      ...BASEMAPS,
      ...IMAGERY_BASEMAPS,
      ...(hasSkinny ? [SKINNYWMS_BASEMAP] : []),
    ]
  }, [sourceA.decorationLayers])

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

  // Sidebar collapse — same affordance as the embedded viewer.
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // -------- Annotations: numbered findings pinned to the map ---------
  const [annotations, setAnnotations] = useState<Array<MapAnnotation>>([])
  const [annotateArmed, setAnnotateArmed] = useState(false)
  const [annotationDraft, setAnnotationDraft] =
    useState<AnnotationDraft | null>(null)
  // Where a new annotation will land, captured at map-click time.
  const pendingRef = useRef<{
    coordinate: [number, number]
    slot: SourceSlot | null
  } | null>(null)

  const onAnnotationCreate = useCallback(
    (coordinate: [number, number], slot: SourceSlot | null) => {
      pendingRef.current = { coordinate, slot }
      setAnnotationDraft({ id: null, text: '', number: -1 })
    },
    [],
  )
  const onAnnotationEdit = useCallback(
    (id: string) => {
      const index = annotations.findIndex((ann) => ann.id === id)
      if (index === -1) return
      setAnnotationDraft({
        id,
        text: annotations[index].text,
        number: index + 1,
      })
    },
    [annotations],
  )
  const saveAnnotation = (text: string) => {
    if (annotationDraft?.id) {
      setAnnotations((prev) =>
        prev.map((ann) =>
          ann.id === annotationDraft.id ? { ...ann, text } : ann,
        ),
      )
    } else if (pendingRef.current) {
      const { coordinate, slot } = pendingRef.current
      setAnnotations((prev) => [
        ...prev,
        { id: nextAnnotationId(), coordinate, text, slot },
      ])
      pendingRef.current = null
    }
    setAnnotationDraft(null)
  }
  const deleteAnnotation = () => {
    if (annotationDraft?.id) {
      setAnnotations((prev) =>
        prev.filter((ann) => ann.id !== annotationDraft.id),
      )
    }
    setAnnotationDraft(null)
  }
  const removeAnnotationById = useCallback(
    (id: string) =>
      setAnnotations((prev) => prev.filter((ann) => ann.id !== id)),
    [],
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

  useGeoShortcuts({
    // Any sidebar open → collapse both; both collapsed → restore both.
    onToggleSidebars: () => {
      const collapse = !(leftCollapsed && rightCollapsed)
      setLeftCollapsed(collapse)
      setRightCollapsed(collapse)
    },
    // Mode keys are comparison-only.
    onMode: (next) => {
      if (hasB) onModeChange(next)
    },
    onFit: fitAction,
    onCopy: () => copyView(null),
    onExport: () => setExportOpen(true),
    onHelp: () => setHelpOpen((v) => !v),
    onAnnotate: () => setAnnotateArmed((v) => !v),
    onAnnotateDisarm: {
      enabled: annotateArmed && annotationDraft === null,
      disarm: () => setAnnotateArmed(false),
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
    baseUrl: a.baseUrl,
    label: a.label,
    layers: sourceA.layers,
    decorationLayers: sourceA.decorationLayers,
    activeOrder: activeOrderA,
    layerOpacities: selection.opacitiesFor('a'),
    resolveTime: resolveTimeA,
    onLoadResult: onLoadResultA,
    timeSteps: rawStepsA,
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
        baseUrl: b.baseUrl,
        label: b.label,
        layers: sourceB.layers,
        decorationLayers: sourceB.decorationLayers,
        activeOrder: activeOrderB,
        layerOpacities: selection.opacitiesFor('b'),
        resolveTime: resolveTimeB,
        onLoadResult: onLoadResultB,
        timeSteps: rawStepsB,
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
        <P className="text-xs text-muted-foreground">{t('panel.corsHint')}</P>
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
    return (
      <div className="flex h-full items-center justify-center gap-2 rounded-md border border-border bg-card text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tExec('lens.loadingLayers')}
      </div>
    )
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
        onRequestAddSource={onRequestAddSource}
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
        annotateArmed={annotateArmed}
        onAnnotateToggle={() => setAnnotateArmed((v) => !v)}
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
      <AnnotationEditorDialog
        draft={
          annotationDraft
            ? {
                ...annotationDraft,
                number:
                  annotationDraft.number === -1
                    ? annotations.length + 1
                    : annotationDraft.number,
              }
            : null
        }
        onSave={saveAnnotation}
        onDelete={deleteAnnotation}
        onClose={() => {
          pendingRef.current = null
          setAnnotationDraft(null)
        }}
      />
      <GeoExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        capture={captureAction}
        legends={exportLegends}
        annotations={annotations}
        meta={{ labelA: a.label, labelB: b?.label ?? null }}
      />
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Collapse hides (not unmounts) the sidebars so working state —
            filter tab, search, level chips, expanded groups — survives
            reopening. */}
        {leftCollapsed && (
          <CollapsedSidebarHandle
            side="left"
            onExpand={() => setLeftCollapsed(false)}
          />
        )}
        <div style={{ display: leftCollapsed ? 'none' : 'contents' }}>
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
              preload={preloadTimeSteps}
              pinnedLegends={pinnedLegendItems}
              onUnpinLegend={unpinLegend}
              measureMode={measureMode}
              measureClearNonce={measureClearNonce}
              overlays={overlays}
              annotations={annotations}
              annotateArmed={annotateArmed}
              onAnnotationCreate={onAnnotationCreate}
              onAnnotationEdit={onAnnotationEdit}
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
              onAnnotationCreate={onAnnotationCreate}
              onAnnotationEdit={onAnnotationEdit}
              basemapId={basemapId}
              basemapOpacity={basemapOpacity}
              onRegisterFit={onRegisterFit}
              onRegisterCapture={onRegisterCapture}
            />
          )}
        </div>
        <div style={{ display: rightCollapsed ? 'none' : 'contents' }}>
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
            onExpand={() => setRightCollapsed(false)}
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
