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
 * In-app WMS viewer for SkinnyWMS lens instances. Two visual states:
 *
 *   - **Empty** (no layers picked yet) — basemap only, with a centered
 *     overview panel: title, short intro, hint about external clients
 *     (QGIS) plus Copy-WMS-URL action, note about SkinnyWMS lacking
 *     WFS/GetFeatureInfo, and a condensed parameter grid for selection.
 *     Multi-level parameters (e.g. specific humidity at 300/500/700 hPa)
 *     collapse into a single cell with a popover to pick a level.
 *
 *   - **Populated** (≥1 active layer) — three-pane layout:
 *     left sidebar with master opacity + a sortable list of active
 *     layers (drag-and-drop = OL stacking order = WMS request order) +
 *     time slider at the bottom; map in the centre with legends and a
 *     pointer read-out; right sidebar with pressure-level filter,
 *     search, and the grouped layer browser.
 *
 * SkinnyWMS only ships GetMap (no GetFeatureInfo / WFS), so click-to-
 * inspect is intentionally absent — the overview panel surfaces this so
 * users know to load the source GRIB into a real GIS for value queries.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Globe2,
  GripVertical,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  Map as MapIcon,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Search,
  SwatchBook,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import 'ol/ol.css'
import OlMap from 'ol/Map'
import View from 'ol/View'
import ImageLayer from 'ol/layer/Image'
import TileLayer from 'ol/layer/Tile'
import VectorTileLayer from 'ol/layer/VectorTile'
import ImageWMS from 'ol/source/ImageWMS'
import XYZ from 'ol/source/XYZ'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import { applyStyle as applyMapboxStyle } from 'ol-mapbox-style'
import {
  expandTimeSteps,
  groupLayers,
  parseCapabilities,
  partitionGroups,
  rebaseLensUrl,
  uniquePressureLevels,
} from './wms-capabilities'
import type VectorTileSource from 'ol/source/VectorTile'
import type MapBrowserEvent from 'ol/MapBrowserEvent'
import type {
  LayerGroup,
  ParsedLayer,
  PartitionedGroups,
} from './wms-capabilities'
import { showToast } from '@/lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('WmsViewer')

type BasemapOption =
  | {
      type: 'raster'
      id: string
      label: string
      url: string
      attribution: string
      tilePixelRatio: number
    }
  | {
      type: 'vector'
      id: string
      label: string
      // Mapbox-style JSON URL; ol-mapbox-style fetches it, builds the
      // source from its `sources` block, and applies styling.
      styleUrl: string
    }

const BASEMAPS: ReadonlyArray<BasemapOption> = [
  {
    type: 'vector',
    id: 'carto-positron-vector',
    label: 'Carto Positron (Vector)',
    styleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    type: 'raster',
    id: 'carto-positron',
    label: 'Carto Positron',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    tilePixelRatio: 1,
  },
]
const DEFAULT_BASEMAP_ID = BASEMAPS[0].id
const DEFAULT_LAYER_OPACITY = 0.85

// Standard Web Mercator world extent (projection asymptotes at ±85.0511°);
// constrains panning to the basemap's coverage.
const WEB_MERCATOR_EXTENT: [number, number, number, number] = [
  ...fromLonLat([-180, -85.0511]),
  ...fromLonLat([180, 85.0511]),
] as [number, number, number, number]

// Initial fit target — full longitude, latitude biased north so Antarctica
// is cropped and Scandinavia gets proper screen real estate. "Fit to
// globe" toolbar button overrides with the full WMS bbox.
const INITIAL_VIEW_BBOX_WGS84: [number, number, number, number] = [
  -180, -55, 180, 85,
]

type BasemapLayer = TileLayer<XYZ> | VectorTileLayer

function makeBasemapLayer(opt: BasemapOption): BasemapLayer {
  if (opt.type === 'raster') {
    const source = new XYZ({
      url: opt.url,
      attributions: opt.attribution,
      // crossOrigin: required so canvas.toBlob (download/copy) doesn't
      // taint. wrapX: false because ImageWMS overlays don't wrap, and a
      // wrapping basemap would visually diverge from them.
      crossOrigin: 'anonymous',
      wrapX: false,
      tilePixelRatio: opt.tilePixelRatio,
    })
    return new TileLayer({ source })
  }
  // Vector tiles via Mapbox-style JSON. declutter: true prevents label
  // overlap at low zoom.
  const layer = new VectorTileLayer<VectorTileSource>({ declutter: true })
  applyMapboxStyle(layer, opt.styleUrl).catch((err) =>
    log.error('Failed to apply vector basemap style', { error: err }),
  )
  return layer
}

interface WmsViewerProps {
  /** Absolute base URL of the lens, e.g. `http://127.0.0.1:51234`. */
  baseUrl: string
}

interface ManagedLayer {
  layer: ImageLayer<ImageWMS>
  source: ImageWMS
}

// ============================================================
// Main component
// ============================================================

export default function WmsViewer({ baseUrl }: WmsViewerProps) {
  const { t } = useTranslation('executions')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const fittedRef = useRef(false)
  const bboxRef = useRef<[number, number, number, number] | null>(null)
  const managedRef = useRef<Map<string, ManagedLayer>>(new Map())
  const basemapLayerRef = useRef<BasemapLayer | null>(null)

  const [layers, setLayers] = useState<Array<ParsedLayer>>([])
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [loadingLayers, setLoadingLayers] = useState(true)

  // Selection: ordered list (index 0 = top of stack) + per-layer opacity.
  // A layer's *visibility* is implicit (in the array = visible).
  const [activeOrder, setActiveOrder] = useState<Array<string>>([])
  const [layerOpacities, setLayerOpacities] = useState<Map<string, number>>(
    new Map(),
  )
  const [masterOpacity, setMasterOpacity] = useState(1)

  // Tile-load counter drives the toolbar spinner. Clamped at 0 because
  // canceled tiles can swallow the end event.
  const [tilesLoadingCount, setTilesLoadingCount] = useState(0)
  const tilesLoading = tilesLoadingCount > 0
  const incLoading = useCallback(() => setTilesLoadingCount((c) => c + 1), [])
  const decLoading = useCallback(
    () => setTilesLoadingCount((c) => Math.max(0, c - 1)),
    [],
  )

  const [pointer, setPointer] = useState<{ lat: number; lon: number } | null>(
    null,
  )

  // Group + level view-models, recomputed when capabilities change.
  const groups = useMemo<Array<LayerGroup>>(() => groupLayers(layers), [layers])
  const partitioned = useMemo(() => partitionGroups(groups), [groups])
  const allLevels = useMemo(() => uniquePressureLevels(groups), [groups])

  // Time-step union across active layers that advertise a TIME dimension.
  const timeSteps = useMemo<Array<string>>(() => {
    const set = new Set<string>()
    for (const name of activeOrder) {
      const layer = layers.find((l) => l.name === name)
      if (!layer?.time) continue
      for (const step of expandTimeSteps(layer.time.raw)) set.add(step)
    }
    return [...set].sort()
  }, [layers, activeOrder])
  const [timeIndex, setTimeIndex] = useState(0)
  const activeTime = timeSteps[timeIndex] ?? null

  useEffect(() => {
    if (timeIndex >= timeSteps.length && timeSteps.length > 0) setTimeIndex(0)
  }, [timeSteps, timeIndex])

  // -------- Capabilities fetch --------

  // Lens `running` status precedes WMS-port readiness; retry hides the race.
  // `retryNonce` re-triggers the effect on manual retry.
  const [retryNonce, setRetryNonce] = useState(0)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    const delaysMs = [300, 600, 1200, 2400, 4800]
    setError(null)
    setLoadingLayers(true)
    setRetrying(false)
    void (async () => {
      let lastErr: unknown
      for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
        if (ac.signal.aborted) return
        try {
          const res = await fetch(
            `${baseUrl}/wms?service=WMS&version=1.3.0&request=GetCapabilities`,
            { signal: ac.signal },
          )
          if (!res.ok) throw new Error(`GetCapabilities ${res.status}`)
          const xml = await res.text()
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- aborted by cleanup
          if (ac.signal.aborted) return
          const parsed = parseCapabilities(xml)
          setLayers(parsed.layers)
          setBbox(parsed.bbox)
          setLoadingLayers(false)
          setRetrying(false)
          return
        } catch (err) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- aborted by cleanup
          if (ac.signal.aborted) return
          lastErr = err
          if (attempt === delaysMs.length) break
          setRetrying(true)
          await new Promise((r) => setTimeout(r, delaysMs[attempt]))
        }
      }
      if (ac.signal.aborted) return
      log.error('Failed to fetch WMS capabilities', { error: lastErr })
      setError(lastErr instanceof Error ? lastErr.message : String(lastErr))
      setLoadingLayers(false)
      setRetrying(false)
    })()
    return () => ac.abort()
  }, [baseUrl, retryNonce])

  const onRetryCapabilities = useCallback(() => setRetryNonce((n) => n + 1), [])

  // -------- OL setup + lifecycle --------

  const tryFit = useCallback((force: boolean = false) => {
    const map = mapRef.current
    if (!map) return
    if (!force && fittedRef.current) return
    const size = map.getSize()
    if (!size || size[0] < 1 || size[1] < 1) return
    // Forced = "Fit to globe" button → full WMS bbox; unforced (initial
    // auto-fit) → Europe-centric default. Falls back to the default if
    // the WMS bbox isn't known yet.
    const targetWgs84 =
      force && bboxRef.current ? bboxRef.current : INITIAL_VIEW_BBOX_WGS84
    fittedRef.current = true
    const view = map.getView()
    const extent = transformExtent(
      targetWgs84,
      'EPSG:4326',
      view.getProjection(),
    )
    view.fit(extent, { padding: [40, 40, 40, 40] })
  }, [])

  const [basemapId, setBasemapId] = useState<string>(DEFAULT_BASEMAP_ID)
  const previousBasemapIdRef = useRef<string>(DEFAULT_BASEMAP_ID)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Mount with default basemap; swap effect below adopts user choice.
    const basemap = makeBasemapLayer(BASEMAPS[0])
    const source = basemap.getSource()
    source?.on('tileloadstart', incLoading)
    source?.on('tileloadend', decLoading)
    source?.on('tileloaderror', decLoading)
    basemapLayerRef.current = basemap
    const map = new OlMap({
      target: container,
      layers: [basemap],
      view: new View({
        // Pre-fit framing on Europe — avoids a [0,0] world flash before
        // tryFit() runs.
        center: fromLonLat([12, 50]),
        zoom: 3,
        projection: 'EPSG:3857',
        // smoothExtentConstraint: false keeps pans strictly within the
        // world; without it, slight overshoot makes SkinnyWMS return
        // stretched-stripe images for out-of-bounds BBOXes.
        extent: WEB_MERCATOR_EXTENT,
        smoothExtentConstraint: false,
        constrainResolution: false,
      }),
    })
    mapRef.current = map
    // Sheets animate in from off-screen; the container is 0×0 at mount
    // time. Watch for resize and tell OL to recompute viewport size so
    // tiles render once the drawer settles. Auto-fit kicks in here too —
    // fit() needs valid pixel dimensions only available post-resize.
    const ro = new ResizeObserver(() => {
      map.updateSize()
      tryFit()
    })
    ro.observe(container)
    return () => {
      ro.disconnect()
      map.setTarget(undefined)
      mapRef.current = null
      managedRef.current.clear()
    }
  }, [baseUrl, tryFit, incLoading, decLoading])

  useEffect(() => {
    bboxRef.current = bbox
    tryFit()
  }, [bbox, tryFit])

  // -------- Basemap swap --------
  // Full layer replacement (not setSource) because raster (TileLayer) and
  // vector (VectorTileLayer) basemaps are different OL layer types.
  useEffect(() => {
    const map = mapRef.current
    const oldLayer = basemapLayerRef.current
    if (!map || !oldLayer) return
    if (previousBasemapIdRef.current === basemapId) return
    previousBasemapIdRef.current = basemapId
    const opt = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0]
    const newLayer = makeBasemapLayer(opt)
    const source = newLayer.getSource()
    source?.on('tileloadstart', incLoading)
    source?.on('tileloadend', decLoading)
    source?.on('tileloaderror', decLoading)
    map.removeLayer(oldLayer)
    map.getLayers().insertAt(0, newLayer)
    basemapLayerRef.current = newLayer
  }, [basemapId, incLoading, decLoading])

  // -------- WMS layer rendering --------
  // One ImageLayer per active layer. Single-image mode (vs. TileWMS) so
  // OL atomically swaps to the new image when params change — avoids the
  // staggered per-tile sweep that flickers during time-slider scrubbing.
  // Index 0 = topmost; effective opacity = master × per-layer.

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const managed = managedRef.current

    const wantedNames = new Set<string>()
    activeOrder.forEach((layerName, idx) => {
      const layer = layers.find((l) => l.name === layerName)
      if (!layer || layer.styles.length === 0) return
      const style = layer.styles[0]
      wantedNames.add(layerName)

      const params: Record<string, string> = {
        LAYERS: layerName,
        STYLES: style.name,
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
      }
      if (layer.time && activeTime) params.TIME = activeTime

      const perLayer = layerOpacities.get(layerName) ?? DEFAULT_LAYER_OPACITY
      const effectiveOpacity = perLayer * masterOpacity
      const z = activeOrder.length - idx // index 0 → highest z

      const existing = managed.get(layerName)
      if (existing) {
        existing.source.updateParams(params)
        existing.layer.setOpacity(effectiveOpacity)
        existing.layer.setZIndex(z)
      } else {
        // hidpi: false keeps Magics-rendered symbols (wind barbs, contour
        // widths, isobar labels) at full visual size on retina — the
        // default 2× DPI request halves them. ratio: 1 disables the 1.5×
        // pan-slack oversampling for cleaner cache keys.
        const source = new ImageWMS({
          url: `${baseUrl}/wms`,
          params,
          serverType: 'mapserver',
          crossOrigin: 'anonymous',
          hidpi: false,
          ratio: 1,
        })
        source.on('imageloadstart', incLoading)
        source.on('imageloadend', decLoading)
        source.on('imageloaderror', decLoading)
        const olLayer = new ImageLayer({
          source,
          opacity: effectiveOpacity,
          zIndex: z,
        })
        map.addLayer(olLayer)
        managed.set(layerName, { layer: olLayer, source })
      }
    })

    for (const [name, m] of managed) {
      if (!wantedNames.has(name)) {
        map.removeLayer(m.layer)
        managed.delete(name)
      }
    }
  }, [
    baseUrl,
    layers,
    activeOrder,
    layerOpacities,
    masterOpacity,
    activeTime,
    incLoading,
    decLoading,
  ])

  // -------- Time-step prefetch --------
  // Warms the browser HTTP cache for every (time-aware active layer ×
  // time step) at the current viewport. Same source config as the visible
  // layer, so URLs match and OL hits cache when the user scrubs.
  // Default off — bandwidth-heavy.
  const [preloadTimeSteps, setPreloadTimeSteps] = useState(false)

  useEffect(() => {
    if (!preloadTimeSteps) return
    const map = mapRef.current
    if (!map || timeSteps.length <= 1) return
    const timeAwareActive = activeOrder
      .map((name) => layers.find((l) => l.name === name))
      .filter((l): l is ParsedLayer => !!l && !!l.time && l.styles.length > 0)
    if (timeAwareActive.length === 0) return

    // Object-wrapped so TS-ESLint sees mutability across the await below.
    const state = { cancelled: false }
    const hiddenLayers: Array<ImageLayer<ImageWMS>> = []

    // Hidden ImageLayer per (layer × step), torn down once loaded.
    const prefetchOne = (layer: ParsedLayer, step: string) =>
      new Promise<void>((resolve) => {
        if (state.cancelled) return resolve()
        const source = new ImageWMS({
          url: `${baseUrl}/wms`,
          params: {
            LAYERS: layer.name,
            STYLES: layer.styles[0].name,
            FORMAT: 'image/png',
            TRANSPARENT: 'TRUE',
            TIME: step,
          },
          serverType: 'mapserver',
          crossOrigin: 'anonymous',
          hidpi: false,
          ratio: 1,
        })
        const hidden = new ImageLayer({
          source,
          opacity: 0,
          zIndex: -1,
        })
        let settled = false
        const settle = () => {
          if (settled) return
          settled = true
          map.removeLayer(hidden)
          const i = hiddenLayers.indexOf(hidden)
          if (i >= 0) hiddenLayers.splice(i, 1)
          resolve()
        }
        source.once('imageloadend', settle)
        source.once('imageloaderror', settle)
        // Safety: if the load events never fire (server hung), don't leak.
        window.setTimeout(settle, 30000)
        hiddenLayers.push(hidden)
        map.addLayer(hidden)
      })

    ;(async () => {
      for (const layer of timeAwareActive) {
        for (const step of timeSteps) {
          if (state.cancelled) return
          await prefetchOne(layer, step)
        }
      }
    })()

    return () => {
      state.cancelled = true
      // Best-effort cleanup of any still-attached hidden layers.
      for (const h of hiddenLayers) map.removeLayer(h)
    }
  }, [preloadTimeSteps, baseUrl, activeOrder, layers, timeSteps])

  // -------- Pointer read-out --------

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onMove = (evt: MapBrowserEvent) => {
      if (evt.dragging) return
      const [lon, lat] = toLonLat(evt.coordinate)
      setPointer({ lat, lon })
    }
    const onLeave = () => setPointer(null)
    map.on('pointermove', onMove)
    const target = map.getTargetElement()
    target.addEventListener('mouseleave', onLeave)
    return () => {
      map.un('pointermove', onMove)
      target.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // -------- Selection handlers --------

  const addLayer = useCallback((name: string) => {
    setActiveOrder((prev) => (prev.includes(name) ? prev : [name, ...prev]))
    setLayerOpacities((prev) => {
      if (prev.has(name)) return prev
      const next = new Map(prev)
      next.set(name, DEFAULT_LAYER_OPACITY)
      return next
    })
  }, [])

  const removeLayer = useCallback((name: string) => {
    setActiveOrder((prev) => prev.filter((n) => n !== name))
    setLayerOpacities((prev) => {
      if (!prev.has(name)) return prev
      const next = new Map(prev)
      next.delete(name)
      return next
    })
    setPinnedLegends((prev) => {
      if (!prev.has(name)) return prev
      const next = new Set(prev)
      next.delete(name)
      return next
    })
  }, [])

  // Set of active-layer names whose legend is pinned to the bottom-of-map
  // strip. Pinning is independent of the per-card slide-out, so users can
  // mirror multiple legends at the bottom for side-by-side comparison while
  // keeping the in-card thumbnail behaviour available.
  const [pinnedLegends, setPinnedLegends] = useState<Set<string>>(new Set())
  const togglePinLegend = useCallback((name: string) => {
    setPinnedLegends((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const setLayerOpacity = useCallback((name: string, opacity: number) => {
    setLayerOpacities((prev) => {
      const next = new Map(prev)
      next.set(name, opacity)
      return next
    })
  }, [])

  const reorderLayer = useCallback((from: number, to: number) => {
    setActiveOrder((prev) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= prev.length ||
        to >= prev.length
      ) {
        return prev
      }
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  // Title-bar visibility: default on, user can toggle from the active-layers
  // panel. Affects both the live overlay and what gets baked into the PNG
  // export so screenshots and downloads stay in sync with the viewer.
  const [titleBarEnabled, setTitleBarEnabled] = useState(true)

  // -------- Map export (PNG download / clipboard copy) --------
  // OL composes all canvas-renderer layers onto a single canvas in the
  // map target. With `crossOrigin: 'anonymous'` on the tile sources, the
  // canvas is not tainted, so toBlob() returns a usable image.

  const exportPng = useCallback(async (): Promise<Blob | null> => {
    const map = mapRef.current
    if (!map) return null
    const titles = activeOrder
      .map((name) => layers.find((l) => l.name === name)?.title)
      .filter((title): title is string => !!title)
    // Pre-load any pinned legend images now (cross-origin, anonymous) so
    // they're ready to draw onto the export canvas. If the map render
    // races ahead we'd draw an empty box.
    const legendItems = await loadLegendImages(layers, pinnedLegends, baseUrl)
    return new Promise<Blob | null>((resolve) => {
      map.once('rendercomplete', () => {
        const target = map.getTargetElement()
        const olCanvas = target.querySelector<HTMLCanvasElement>('canvas')
        if (!olCanvas) return resolve(null)
        // Composite OL canvas + (optionally) the title bar onto a fresh
        // canvas. We can't draw text directly onto OL's canvas — it gets
        // overwritten on the next render — and we also want the export to
        // be at the same intrinsic dimensions as the viewer. If any pinned
        // legends are present, the canvas extends downward to fit them in
        // a balanced grid below the map.
        const dpr = window.devicePixelRatio || 1
        const stripHeight =
          legendItems.length > 0
            ? measureLegendStrip(legendItems, olCanvas.width, dpr)
            : 0
        const out = document.createElement('canvas')
        out.width = olCanvas.width
        out.height = olCanvas.height + stripHeight
        const ctx = out.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(olCanvas, 0, 0)
        if (titleBarEnabled && titles.length > 0) {
          drawTitleBar(ctx, out.width, titles, activeTime)
        }
        if (stripHeight > 0) {
          drawLegendStrip(ctx, legendItems, out.width, olCanvas.height, dpr)
        }
        out.toBlob((blob) => resolve(blob), 'image/png')
      })
      map.renderSync()
    })
  }, [activeOrder, layers, activeTime, titleBarEnabled, pinnedLegends, baseUrl])

  const downloadMap = useCallback(async () => {
    try {
      const blob = await exportPng()
      if (!blob) {
        showToast.error(t('lens.mapDownloadFailed'))
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `wms-map-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      log.error('Map download failed', { error: err })
      showToast.error(t('lens.mapDownloadFailed'))
    }
  }, [exportPng, t])

  const copyMap = useCallback(async () => {
    try {
      const blob = await exportPng()
      if (!blob) {
        showToast.error(t('lens.mapCopyFailed'))
        return
      }
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      showToast.success(t('lens.mapCopied'))
    } catch (err) {
      log.error('Map copy failed', { error: err })
      showToast.error(t('lens.mapCopyFailed'))
    }
  }, [exportPng, t])

  // -------- Right-sidebar filter state --------

  const [search, setSearch] = useState('')
  const [selectedLevels, setSelectedLevels] = useState<Set<number>>(new Set())

  const isEmpty = activeOrder.length === 0
  const activeSet = useMemo(() => new Set(activeOrder), [activeOrder])

  // The parameter-grid overview is an onboarding screen: it shows once at
  // first open, then the user picks via the right sidebar from then on. We
  // flip `hasInteracted` the first time the active set becomes non-empty
  // and never flip back, even if the user later removes everything.
  const [hasInteracted, setHasInteracted] = useState(false)
  // Sidebar collapse state — both default to expanded; the user can hide
  // either side and re-open it from the thin handle strip that takes its
  // place. Doesn't affect the overview-empty-state since that's only shown
  // before any interaction.
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  useEffect(() => {
    if (!hasInteracted && activeOrder.length > 0) setHasInteracted(true)
  }, [activeOrder.length, hasInteracted])
  const showOverview = isEmpty && !hasInteracted
  const showSidebars = !showOverview

  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
      {error && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-destructive/15 px-4 py-2 text-sm text-destructive">
          <span className="truncate">{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetryCapabilities}
            className="h-7 shrink-0 gap-1.5"
          >
            <RefreshCw className="h-3 w-3" />
            {t('lens.retry')}
          </Button>
        </div>
      )}
      {retrying && !error && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-muted/80 px-4 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{t('lens.retrying')}</span>
        </div>
      )}

      {showSidebars &&
        (leftCollapsed ? (
          <CollapsedSidebarHandle
            side="left"
            onExpand={() => setLeftCollapsed(false)}
          />
        ) : (
          <ActiveLayersPanel
            baseUrl={baseUrl}
            layers={layers}
            activeOrder={activeOrder}
            layerOpacities={layerOpacities}
            masterOpacity={masterOpacity}
            onMasterOpacity={setMasterOpacity}
            onLayerOpacity={setLayerOpacity}
            onRemove={removeLayer}
            onReorder={reorderLayer}
            timeSteps={timeSteps}
            timeIndex={Math.min(timeIndex, Math.max(0, timeSteps.length - 1))}
            onTimeIndex={setTimeIndex}
            titleBarEnabled={titleBarEnabled}
            onTitleBarEnabled={setTitleBarEnabled}
            preloadTimeSteps={preloadTimeSteps}
            onPreloadTimeSteps={setPreloadTimeSteps}
            pinnedLegends={pinnedLegends}
            onTogglePinLegend={togglePinLegend}
            onCollapse={() => setLeftCollapsed(true)}
          />
        ))}

      <div className="relative min-w-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />

        {showSidebars && titleBarEnabled && activeOrder.length > 0 && (
          <MapTitleBar
            layers={layers}
            activeOrder={activeOrder}
            activeTime={activeTime}
          />
        )}

        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
          {tilesLoading && (
            <div
              role="status"
              title={t('lens.loadingTiles')}
              aria-label={t('lens.loadingTiles')}
              className="flex h-7 w-7 items-center justify-center text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => tryFit(true)}
            title={t('lens.fitGlobe')}
            aria-label={t('lens.fitGlobe')}
          >
            <Globe2 className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t('lens.basemap')}
                  aria-label={t('lens.basemap')}
                />
              }
            >
              <Layers className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-56 p-1">
              <P className="px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('lens.basemap')}
              </P>
              <div className="flex flex-col">
                {BASEMAPS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBasemapId(b.id)}
                    aria-pressed={b.id === basemapId}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                      b.id === basemapId && 'bg-accent font-medium',
                    )}
                  >
                    <span>{b.label}</span>
                    {b.id === basemapId && (
                      <span className="text-xs text-muted-foreground">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {showSidebars && activeOrder.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => void downloadMap()}
                title={t('lens.downloadMap')}
                aria-label={t('lens.downloadMap')}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => void copyMap()}
                title={t('lens.copyMap')}
                aria-label={t('lens.copyMap')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {pointer && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md border border-border bg-background/90 px-2.5 py-1 font-mono text-xs tabular-nums shadow-sm backdrop-blur-sm">
            {formatLatLon(pointer.lat, pointer.lon)}
          </div>
        )}

        {showOverview && (
          <WmsOverviewPanel
            partitioned={partitioned}
            loading={loadingLayers}
            onPick={addLayer}
          />
        )}

        {showSidebars && pinnedLegends.size > 0 && (
          <PinnedLegendsBar
            baseUrl={baseUrl}
            layers={layers}
            pinnedLegends={pinnedLegends}
            onUnpin={togglePinLegend}
          />
        )}
      </div>

      {showSidebars &&
        (rightCollapsed ? (
          <CollapsedSidebarHandle
            side="right"
            onExpand={() => setRightCollapsed(false)}
          />
        ) : (
          <LayerBrowserPanel
            partitioned={partitioned}
            allLevels={allLevels}
            activeSet={activeSet}
            search={search}
            onSearch={setSearch}
            selectedLevels={selectedLevels}
            onSelectedLevels={setSelectedLevels}
            onPick={addLayer}
            onRemove={removeLayer}
            loading={loadingLayers}
            onCollapse={() => setRightCollapsed(true)}
          />
        ))}
    </div>
  )
}

// ============================================================
// Map title bar (top-centre of map area)
// ============================================================

/**
 * Compact summary of what's currently on the map: active layer titles,
 * separated by middots, plus the forecast time when one is set. Floats at
 * top-centre of the map so a screenshot/download captures the full context
 * without the user needing to caption it manually.
 */
function MapTitleBar({
  layers,
  activeOrder,
  activeTime,
}: {
  layers: ReadonlyArray<ParsedLayer>
  activeOrder: ReadonlyArray<string>
  activeTime: string | null
}) {
  const titles = activeOrder
    .map((name) => layers.find((l) => l.name === name)?.title)
    .filter((title): title is string => !!title)
  if (titles.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[60%] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
      <P className="truncate font-medium" title={titles.join(' · ')}>
        {titles.join(' · ')}
      </P>
      {activeTime && (
        <span className="border-l border-border pl-2 font-mono text-muted-foreground tabular-nums">
          {formatStep(activeTime)}
        </span>
      )}
    </div>
  )
}

// ============================================================
// Empty-state overview panel
// ============================================================

function WmsOverviewPanel({
  partitioned,
  loading,
  onPick,
}: {
  partitioned: PartitionedGroups
  loading: boolean
  onPick: (layerName: string) => void
}) {
  const { t } = useTranslation('executions')
  const empty =
    partitioned.singles.length === 0 && partitioned.multiLevel.length === 0
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="pointer-events-auto flex max-h-full w-[95%] max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-sm">
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-primary" />
            <P className="text-lg font-semibold">{t('lens.overview.title')}</P>
          </div>
          <P className="text-sm text-muted-foreground">
            {t('lens.overview.intro')}
          </P>
        </div>
        <Separator />
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('lens.loadingLayers')}
            </div>
          ) : empty ? (
            <P className="text-sm text-muted-foreground">
              {t('lens.noLayers')}
            </P>
          ) : (
            <>
              {partitioned.singles.length > 0 && (
                <section>
                  <P className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('lens.surfaceParameters')}
                  </P>
                  <ParameterGrid groups={partitioned.singles} onPick={onPick} />
                </section>
              )}
              {partitioned.multiLevel.length > 0 && (
                <section>
                  <P className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('lens.pressureLevelParameters')}
                  </P>
                  <ParameterGrid
                    groups={partitioned.multiLevel}
                    onPick={onPick}
                  />
                </section>
              )}
            </>
          )}
        </div>
        <Separator />
        <div className="p-5">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 p-3 text-sm dark:bg-amber-500/5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <P className="text-amber-900 dark:text-amber-200">
              {t('lens.overview.noWfsNote')}
            </P>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Parameter grid + cell (overview panel)
// ============================================================

function ParameterGrid({
  groups,
  onPick,
}: {
  groups: ReadonlyArray<LayerGroup>
  onPick: (layerName: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {groups.map((g) => (
        <ParameterCell key={g.key} group={g} onPick={onPick} />
      ))}
    </div>
  )
}

function ParameterCell({
  group,
  onPick,
}: {
  group: LayerGroup
  onPick: (layerName: string) => void
}) {
  const { t } = useTranslation('executions')
  const isMulti =
    group.entries.length > 1 && group.entries.some((e) => e.level !== null)

  if (!isMulti) {
    const layer = group.entries[0].layer
    return (
      <button
        type="button"
        onClick={() => onPick(layer.name)}
        className="group flex min-h-16 flex-col items-start justify-between rounded-md border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
      >
        <span className="line-clamp-2 text-sm font-medium" title={group.title}>
          {group.title}
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
          <Plus className="h-3 w-3" />
          {t('lens.addLayer')}
        </span>
      </button>
    )
  }

  const unit = group.levelUnit ?? 'hPa'
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="group flex min-h-16 flex-col items-start justify-between rounded-md border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
          />
        }
      >
        <div className="min-w-0">
          <span
            className="line-clamp-2 text-sm font-medium"
            title={group.title}
          >
            {group.title}
          </span>
          {group.subtitle && (
            <span
              className="block truncate font-mono text-xs text-muted-foreground"
              title={group.subtitle}
            >
              {group.subtitle}
            </span>
          )}
        </div>
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Layers className="h-3 w-3" />
          {t('lens.levelsCount', { count: group.entries.length })}
          <ChevronDown className="h-3 w-3" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2">
        <P className="px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('lens.selectLevel')}
        </P>
        <div className="grid grid-cols-3 gap-1">
          {group.entries.map((e) => (
            <Button
              key={e.layer.name}
              variant="outline"
              size="sm"
              className="h-7 px-2 font-mono text-xs"
              onClick={() => onPick(e.layer.name)}
            >
              {e.level} {unit}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ============================================================
// Active layers panel (left sidebar)
// ============================================================

function ActiveLayersPanel({
  baseUrl,
  layers,
  activeOrder,
  layerOpacities,
  masterOpacity,
  onMasterOpacity,
  onLayerOpacity,
  onRemove,
  onReorder,
  timeSteps,
  timeIndex,
  onTimeIndex,
  titleBarEnabled,
  onTitleBarEnabled,
  preloadTimeSteps,
  onPreloadTimeSteps,
  pinnedLegends,
  onTogglePinLegend,
  onCollapse,
}: {
  baseUrl: string
  layers: ReadonlyArray<ParsedLayer>
  activeOrder: ReadonlyArray<string>
  layerOpacities: ReadonlyMap<string, number>
  masterOpacity: number
  onMasterOpacity: (v: number) => void
  onLayerOpacity: (name: string, v: number) => void
  onRemove: (name: string) => void
  onReorder: (from: number, to: number) => void
  timeSteps: ReadonlyArray<string>
  timeIndex: number
  onTimeIndex: (i: number) => void
  titleBarEnabled: boolean
  onTitleBarEnabled: (v: boolean) => void
  preloadTimeSteps: boolean
  onPreloadTimeSteps: (v: boolean) => void
  pinnedLegends: ReadonlySet<string>
  onTogglePinLegend: (name: string) => void
  onCollapse: () => void
}) {
  const { t } = useTranslation('executions')
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-background">
      <div className="border-b border-border bg-muted/40 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('lens.activeLayers')}
            </P>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground"
                  />
                }
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="max-w-80 whitespace-pre-line"
              >
                {t('lens.activeLayersHelp')}
              </TooltipContent>
            </Tooltip>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onCollapse}
            title={t('lens.collapseSidebar')}
            aria-label={t('lens.collapseSidebar')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <P className="text-xs font-medium text-muted-foreground">
              {t('lens.masterOpacity')}
            </P>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {Math.round(masterOpacity * 100)}%
            </span>
          </div>
          <Slider
            value={[Math.round(masterOpacity * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => onMasterOpacity(firstNumber(v) / 100)}
          />
        </div>
        <label className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t('lens.titleBar')}</span>
          <Switch
            size="sm"
            checked={titleBarEnabled}
            onCheckedChange={onTitleBarEnabled}
          />
        </label>
        {timeSteps.length > 1 && (
          <label className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              {t('lens.preloadTimeSteps')}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground"
                    />
                  }
                >
                  <HelpCircle className="h-3 w-3" />
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-72 whitespace-pre-line"
                >
                  {t('lens.preloadTimeStepsHelp')}
                </TooltipContent>
              </Tooltip>
            </span>
            <Switch
              size="sm"
              checked={preloadTimeSteps}
              onCheckedChange={onPreloadTimeSteps}
            />
          </label>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="space-y-2">
          {activeOrder.map((name, idx) => {
            const layer = layers.find((l) => l.name === name)
            if (!layer) return null
            return (
              <SortableLayerItem
                key={name}
                index={idx}
                layer={layer}
                baseUrl={baseUrl}
                opacity={layerOpacities.get(name) ?? DEFAULT_LAYER_OPACITY}
                onOpacity={(v) => onLayerOpacity(name, v)}
                onRemove={() => onRemove(name)}
                onReorder={onReorder}
                pinned={pinnedLegends.has(name)}
                onTogglePin={() => onTogglePinLegend(name)}
              />
            )
          })}
        </ul>
      </div>
      {timeSteps.length > 0 && (
        <TimeSlider
          steps={timeSteps}
          index={timeIndex}
          onChange={onTimeIndex}
        />
      )}
    </aside>
  )
}

function SortableLayerItem({
  index,
  layer,
  baseUrl,
  opacity,
  onOpacity,
  onRemove,
  onReorder,
  pinned,
  onTogglePin,
}: {
  index: number
  layer: ParsedLayer
  baseUrl: string
  opacity: number
  onOpacity: (v: number) => void
  onRemove: () => void
  onReorder: (from: number, to: number) => void
  pinned: boolean
  onTogglePin: () => void
}) {
  const { t } = useTranslation('executions')
  const [over, setOver] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const legendUrl = layer.styles[0]?.legendUrl
    ? rebaseLensUrl(layer.styles[0].legendUrl, baseUrl)
    : null

  return (
    <li
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const raw = e.dataTransfer.getData('text/x-active-layer-index')
        const from = Number(raw)
        if (Number.isInteger(from)) onReorder(from, index)
      }}
      className={cn(
        'rounded-md border bg-card transition-colors',
        over ? 'border-primary' : 'border-border',
      )}
    >
      {/* Only the upper section initiates drags; the slider area below the
          divider is excluded so its pointer events go to Base UI's slider
          gesture handler instead of bubbling into the drag source. */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/x-active-layer-index', String(index))
          e.dataTransfer.effectAllowed = 'move'
        }}
        className="flex cursor-grab items-start gap-2 p-2.5 active:cursor-grabbing"
      >
        <button
          type="button"
          aria-label={t('lens.dragHandle')}
          title={t('lens.dragHandle')}
          className="text-muted-foreground hover:text-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <P className="truncate text-sm font-medium" title={layer.title}>
            {layer.title}
          </P>
          <P
            className="truncate font-mono text-xs text-muted-foreground"
            title={layer.name}
          >
            {layer.name}
          </P>
        </div>
        {legendUrl && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6',
              legendOpen && 'bg-accent text-accent-foreground',
            )}
            onClick={(e) => {
              e.stopPropagation()
              setLegendOpen((v) => !v)
            }}
            aria-label={t('lens.toggleLegend')}
            aria-pressed={legendOpen}
            title={t('lens.toggleLegend')}
          >
            <SwatchBook className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            // Stop the parent draggable from interpreting the click as a
            // drag initiation gesture.
            e.stopPropagation()
            onRemove()
          }}
          aria-label={t('lens.removeLayer')}
          title={t('lens.removeLayer')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-1 border-t border-border px-2.5 pt-2 pb-2.5">
        <div className="flex items-center justify-between">
          <P className="text-xs font-medium text-muted-foreground">
            {t('lens.opacity')}
          </P>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <Slider
          value={[Math.round(opacity * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) => onOpacity(firstNumber(v) / 100)}
        />
      </div>
      {legendUrl && (
        <div
          // Slide-out legend section. `grid-rows-[0fr→1fr]` is the
          // standard "transition height: auto" trick — the inner block
          // is a child whose `min-h-0` prevents collapse, and the row
          // template ratio drives the open/close height.
          className={cn(
            'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out',
            legendOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
          aria-hidden={!legendOpen}
        >
          <div className="min-h-0">
            <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-2.5 py-2.5">
              <div className="min-w-0 flex-1">
                <LegendImage url={legendUrl} title={layer.title} />
              </div>
              <Button
                variant={pinned ? 'default' : 'ghost'}
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin()
                }}
                aria-pressed={pinned}
                title={pinned ? t('lens.unpinLegend') : t('lens.pinLegend')}
                aria-label={
                  pinned ? t('lens.unpinLegend') : t('lens.pinLegend')
                }
              >
                <Pin className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Sidebar-thumbnail of a layer legend with a pop-out hover-zoom. Hover
 * reveals a full-size copy in a popover anchored to the right of the
 * sidebar; the close timer lets the cursor travel between trigger and
 * content without flicker. Pinning lives one level up — the parent renders
 * a Pin button next to this thumbnail and a `PinnedLegendsBar` at the
 * bottom of the map for side-by-side comparison.
 */
function LegendImage({ url, title }: { url: string; title: string }) {
  const [hovered, setHovered] = useState(false)
  const closeTimer = useRef<number | null>(null)

  const cancelTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const enter = useCallback(() => {
    cancelTimer()
    setHovered(true)
  }, [cancelTimer])
  const leave = useCallback(() => {
    cancelTimer()
    closeTimer.current = window.setTimeout(() => {
      setHovered(false)
      closeTimer.current = null
    }, 200)
  }, [cancelTimer])
  useEffect(() => () => cancelTimer(), [cancelTimer])

  return (
    <Popover
      open={hovered}
      onOpenChange={(o) => {
        if (!o) {
          cancelTimer()
          setHovered(false)
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            onMouseEnter={enter}
            onMouseLeave={leave}
            className="block w-full cursor-zoom-in rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <img
          src={url}
          alt={`${title} legend`}
          className="h-auto max-h-32 w-full object-contain"
          loading="lazy"
        />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        sideOffset={12}
        align="start"
        className="w-auto max-w-2xl p-2"
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <img
          src={url}
          alt={`${title} legend`}
          className="h-auto max-h-[70vh] w-auto max-w-[640px] object-contain"
          loading="lazy"
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Floating strip at the bottom of the map area listing every legend the
 * user has pinned. Responsive grid: 1 / 2 / 3 columns based on viewport
 * width so a wide screen can show three legends side-by-side. Each card
 * shows the layer title, the legend image, and an unpin button.
 */
function PinnedLegendsBar({
  baseUrl,
  layers,
  pinnedLegends,
  onUnpin,
}: {
  baseUrl: string
  layers: ReadonlyArray<ParsedLayer>
  pinnedLegends: ReadonlySet<string>
  onUnpin: (name: string) => void
}) {
  const { t } = useTranslation('executions')
  const items = Array.from(pinnedLegends)
    .map((name) => layers.find((l) => l.name === name))
    .filter((l): l is ParsedLayer => !!l && !!l.styles[0]?.legendUrl)
  if (items.length === 0) return null
  // Pick column count to match item count exactly (so the strip always
  // fills the row), capped at 3 on very wide screens. Special case: 4
  // items become 2×2 instead of 3+1, which the user explicitly preferred
  // over an unbalanced last row. With a single legend we cap the grid to
  // a narrower width and centre it — full-width-with-aspect-ratio makes
  // the card unnecessarily tall.
  const gridClass =
    items.length === 1
      ? 'grid-cols-1 sm:max-w-md sm:mx-auto'
      : items.length === 2 || items.length === 4
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 max-h-[45%] overflow-y-auto">
      <div className="pointer-events-auto m-3">
        <div className={cn('grid gap-2', gridClass)}>
          {items.map((layer) => {
            const legendUrl = rebaseLensUrl(layer.styles[0].legendUrl!, baseUrl)
            return (
              <div
                key={layer.name}
                className="flex items-start gap-2 rounded border border-border bg-card px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <P
                    className="truncate text-xs font-medium"
                    title={layer.title}
                  >
                    {layer.title}
                  </P>
                  <img
                    src={legendUrl}
                    alt={`${layer.title} legend`}
                    className="mt-1 h-auto max-h-40 w-full object-contain"
                    loading="lazy"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => onUnpin(layer.name)}
                  aria-label={t('lens.unpinLegend')}
                  title={t('lens.unpinLegend')}
                >
                  <PinOff className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Layer browser (right sidebar)
// ============================================================

function LayerBrowserPanel({
  partitioned,
  allLevels,
  activeSet,
  search,
  onSearch,
  selectedLevels,
  onSelectedLevels,
  onPick,
  onRemove,
  loading,
  onCollapse,
}: {
  partitioned: PartitionedGroups
  allLevels: ReadonlyArray<number>
  activeSet: ReadonlySet<string>
  search: string
  onSearch: (v: string) => void
  selectedLevels: ReadonlySet<number>
  onSelectedLevels: (next: Set<number>) => void
  onPick: (name: string) => void
  onRemove: (name: string) => void
  loading: boolean
  onCollapse: () => void
}) {
  const { t } = useTranslation('executions')
  const [filterOpen, setFilterOpen] = useState(false)

  // Search applies to both buckets; the level filter only narrows the
  // multi-level bucket — surface / single-level groups stay visible
  // regardless so users can always see the non-pressure-level options.
  const matchesSearch = (g: LayerGroup, q: string): boolean => {
    if (!q) return true
    if (g.title.toLowerCase().includes(q)) return true
    if (g.subtitle && g.subtitle.toLowerCase().includes(q)) return true
    return g.entries.some(
      (e) =>
        e.layer.name.toLowerCase().includes(q) ||
        e.layer.title.toLowerCase().includes(q),
    )
  }

  const filteredSingles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return partitioned.singles.filter((g) => matchesSearch(g, q))
  }, [partitioned.singles, search])

  const filteredMultiLevel = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out: Array<LayerGroup> = []
    for (const g of partitioned.multiLevel) {
      if (!matchesSearch(g, q)) continue
      const entries =
        selectedLevels.size === 0
          ? g.entries
          : g.entries.filter(
              (e) => e.level !== null && selectedLevels.has(e.level),
            )
      if (entries.length === 0) continue
      out.push({ ...g, entries })
    }
    return out
  }, [partitioned.multiLevel, search, selectedLevels])

  const totalCount = partitioned.singles.length + partitioned.multiLevel.length
  const filteredCount = filteredSingles.length + filteredMultiLevel.length

  const toggleLevel = (level: number) => {
    const next = new Set(selectedLevels)
    if (next.has(level)) next.delete(level)
    else next.add(level)
    onSelectedLevels(next)
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <div className="border-b border-border bg-muted/40 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onCollapse}
              title={t('lens.collapseSidebar')}
              aria-label={t('lens.collapseSidebar')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('lens.layers')}
            </P>
          </div>
          <Badge variant="secondary" className="font-mono text-xs">
            {activeSet.size}/{totalCount}
          </Badge>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('lens.searchPlaceholder')}
            className="h-8 pl-7 text-sm"
          />
        </div>
        {allLevels.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
            >
              <span>{t('lens.pressureLevels')}</span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  filterOpen && 'rotate-180',
                )}
              />
            </button>
            {filterOpen && (
              <div className="mt-2 flex flex-wrap gap-1">
                {allLevels.map((level) => {
                  const active = selectedLevels.has(level)
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => toggleLevel(level)}
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-xs',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-accent',
                      )}
                    >
                      {level}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('lens.loadingLayers')}
          </div>
        ) : filteredCount === 0 ? (
          <P className="text-sm text-muted-foreground">
            {t('lens.searchEmpty')}
          </P>
        ) : (
          <>
            {filteredSingles.length > 0 && (
              <section>
                <P className="px-1 pb-1.5 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {t('lens.surfaceParameters')}
                </P>
                <ul className="space-y-1.5">
                  {filteredSingles.map((g) => (
                    <LayerBrowserGroup
                      key={g.key}
                      group={g}
                      activeSet={activeSet}
                      onPick={onPick}
                      onRemove={onRemove}
                    />
                  ))}
                </ul>
              </section>
            )}
            {filteredMultiLevel.length > 0 && (
              <section>
                <P className="px-1 pb-1.5 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {t('lens.pressureLevelParameters')}
                </P>
                <ul className="space-y-1.5">
                  {filteredMultiLevel.map((g) => (
                    <LayerBrowserGroup
                      key={g.key}
                      group={g}
                      activeSet={activeSet}
                      onPick={onPick}
                      onRemove={onRemove}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function LayerBrowserGroup({
  group,
  activeSet,
  onPick,
  onRemove,
}: {
  group: LayerGroup
  activeSet: ReadonlySet<string>
  onPick: (name: string) => void
  onRemove: (name: string) => void
}) {
  const { t } = useTranslation('executions')
  const isMulti =
    group.entries.length > 1 && group.entries.some((e) => e.level !== null)
  const [open, setOpen] = useState(false)

  if (!isMulti) {
    const e = group.entries[0]
    const active = activeSet.has(e.layer.name)
    return (
      <li>
        <LayerBrowserRow
          title={group.title}
          subtitle={e.layer.name}
          active={active}
          onAdd={() => onPick(e.layer.name)}
          onRemove={() => onRemove(e.layer.name)}
        />
      </li>
    )
  }

  const unit = group.levelUnit ?? 'hPa'
  const activeCount = group.entries.reduce(
    (n, e) => (activeSet.has(e.layer.name) ? n + 1 : n),
    0,
  )

  return (
    <li className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
      >
        <ChevronDown
          className={cn(
            'mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <P className="truncate text-sm font-medium" title={group.title}>
            {group.title}
          </P>
          {group.subtitle && (
            <P
              className="truncate font-mono text-xs text-muted-foreground"
              title={group.subtitle}
            >
              {group.subtitle}
            </P>
          )}
        </div>
        <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 font-mono">
              {activeCount}
            </Badge>
          )}
          <span>{t('lens.levelsCount', { count: group.entries.length })}</span>
        </span>
      </button>
      {open && (
        <ul className="border-t border-border px-1 py-1">
          {group.entries.map((e) => {
            const active = activeSet.has(e.layer.name)
            return (
              <li key={e.layer.name} className="px-1 py-0.5">
                <LayerBrowserRow
                  title={
                    e.level !== null ? `${e.level} ${unit}` : e.layer.title
                  }
                  subtitle={e.layer.name}
                  active={active}
                  compact
                  onAdd={() => onPick(e.layer.name)}
                  onRemove={() => onRemove(e.layer.name)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

function LayerBrowserRow({
  title,
  subtitle,
  active,
  compact = false,
  onAdd,
  onRemove,
}: {
  title: string
  subtitle?: string
  active: boolean
  compact?: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('executions')
  return (
    <button
      type="button"
      onClick={() => (active ? onRemove() : onAdd())}
      className={cn(
        'flex w-full items-center gap-2 rounded text-left transition-colors hover:bg-accent',
        compact ? 'px-1.5 py-1' : 'px-2 py-1.5',
        active && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <div className="min-w-0 flex-1">
        <P
          className={cn(
            'truncate font-medium',
            compact ? 'font-mono text-xs' : 'text-sm',
          )}
          title={title}
        >
          {title}
        </P>
        {subtitle && !compact && (
          <P
            className="truncate font-mono text-xs text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </P>
        )}
      </div>
      {active ? (
        <X
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-label={t('lens.removeLayer')}
        />
      ) : (
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

// ============================================================
// Time slider (bottom of left sidebar)
// ============================================================

/** Wall-clock interval per step when auto-playing. ~1.2s gives the user
 * time to read each frame; the loop wraps back to step 0 at the end. */
const AUTOPLAY_INTERVAL_MS = 1200

function TimeSlider({
  steps,
  index,
  onChange,
}: {
  steps: ReadonlyArray<string>
  index: number
  onChange: (i: number) => void
}) {
  const { t } = useTranslation('executions')
  const safeIndex = Math.max(0, Math.min(index, steps.length - 1))
  const current = steps[safeIndex] ?? ''
  const [playing, setPlaying] = useState(false)

  // Capture the latest index in a ref so the interval callback always
  // advances from the current position even though the effect itself only
  // re-runs when `playing` or `steps.length` changes.
  const indexRef = useRef(safeIndex)
  indexRef.current = safeIndex
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!playing || steps.length <= 1) return
    const id = window.setInterval(() => {
      const next = (indexRef.current + 1) % steps.length
      onChangeRef.current(next)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [playing, steps.length])

  useEffect(() => {
    if (steps.length <= 1) setPlaying(false)
  }, [steps.length])

  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('lens.time')}
          </P>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground"
                />
              }
            >
              <HelpCircle className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-80 whitespace-pre-line">
              {t('lens.timeHelp')}
            </TooltipContent>
          </Tooltip>
        </div>
        <span className="font-mono text-xs tabular-nums">
          {formatStep(current)}
        </span>
      </div>
      <Slider
        value={[safeIndex]}
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        onValueChange={(v) => onChange(firstNumber(v))}
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          variant={playing ? 'default' : 'outline'}
          size="icon"
          className="h-7 w-7"
          disabled={steps.length <= 1}
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? t('lens.pause') : t('lens.play')}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {safeIndex + 1} / {steps.length}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={steps.length <= 1}
            // Wrap to the last step when stepping back from the first.
            onClick={() =>
              onChange((safeIndex - 1 + steps.length) % steps.length)
            }
            aria-label={t('lens.prevStep')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={steps.length <= 1}
            // Wrap to the first step when stepping forward from the last —
            // matches the autoplay behaviour so "click next, next, next"
            // cycles indefinitely.
            onClick={() => onChange((safeIndex + 1) % steps.length)}
            aria-label={t('lens.nextStep')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

function firstNumber(
  value: number | ReadonlyArray<number> | undefined,
): number {
  if (typeof value === 'number') return value
  if (Array.isArray(value)) {
    const v = value[0]
    return typeof v === 'number' ? v : 0
  }
  return 0
}

/**
 * Format a longitude/latitude pair as `lat,lon` to 3 decimals — at the
 * equator that's roughly 100 m precision, plenty for hover read-out.
 * Wraps `lon` into [-180, 180] so antimeridian crossings stay readable.
 */
function formatLatLon(lat: number, lon: number): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  return `${lat.toFixed(3)}°, ${wrapped.toFixed(3)}°`
}

function formatStep(iso: string): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
  )
}

/**
 * Thin vertical strip rendered in place of a sidebar when the user
 * collapses it. Holds a single chevron button that re-expands the panel.
 * The chevron points toward the viewport-centre to suggest "open this way".
 */
function CollapsedSidebarHandle({
  side,
  onExpand,
}: {
  side: 'left' | 'right'
  onExpand: () => void
}) {
  const { t } = useTranslation('executions')
  const Icon = side === 'left' ? ChevronRight : ChevronLeft
  return (
    <div
      className={cn(
        'flex w-8 shrink-0 flex-col items-center bg-muted/40 py-2',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onExpand}
        title={t('lens.expandSidebar')}
        aria-label={t('lens.expandSidebar')}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </div>
  )
}

/**
 * Paint the on-screen title bar onto the export canvas. The OL canvas is at
 * device pixel ratio (so on a 2× display we get a 2×-scaled bitmap), and we
 * scale font / padding accordingly so the baked-in title visually matches
 * what's on screen rather than appearing tiny on retina exports.
 *
 * Layout: pill at top-centre, 16 dpr-px from the top edge. Single line; long
 * titles truncate with an ellipsis rather than squeezing.
 */
function drawTitleBar(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  titles: ReadonlyArray<string>,
  activeTime: string | null,
): void {
  const dpr = window.devicePixelRatio || 1
  const fontPx = 14 * dpr
  const padX = 16 * dpr
  const padY = 8 * dpr
  const top = 16 * dpr
  const radius = 8 * dpr
  const titleText = titles.join(' · ')
  const timeText = activeTime ? formatStep(activeTime) : ''

  ctx.save()
  ctx.font = `500 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textBaseline = 'middle'

  const sepWidth = timeText
    ? ctx.measureText('  ').width + 1 * dpr // small gap on either side of divider
    : 0
  const timeWidth = timeText ? ctx.measureText(timeText).width : 0
  const maxBoxWidth = canvasWidth - 40 * dpr
  const reservedForTime = timeText ? sepWidth + timeWidth : 0
  const titleAvail = maxBoxWidth - padX * 2 - reservedForTime
  const fitTitle = ellipsizeToWidth(ctx, titleText, titleAvail)
  const fitTitleWidth = ctx.measureText(fitTitle).width
  const innerWidth = fitTitleWidth + reservedForTime
  const boxWidth = Math.min(innerWidth + padX * 2, maxBoxWidth)
  const boxHeight = fontPx + padY * 2
  const boxX = Math.round((canvasWidth - boxWidth) / 2)
  const boxY = top
  const centerY = boxY + boxHeight / 2

  // Background pill
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
  ctx.lineWidth = 1 * dpr
  roundedRectPath(ctx, boxX, boxY, boxWidth, boxHeight, radius)
  ctx.fill()
  ctx.stroke()

  let cursorX = boxX + padX
  ctx.fillStyle = '#111'
  ctx.textAlign = 'left'
  ctx.fillText(fitTitle, cursorX, centerY)
  cursorX += fitTitleWidth

  if (timeText) {
    cursorX += sepWidth / 2
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.beginPath()
    ctx.moveTo(cursorX, boxY + padY)
    ctx.lineTo(cursorX, boxY + boxHeight - padY)
    ctx.stroke()
    cursorX += sepWidth / 2
    ctx.fillStyle = '#555'
    ctx.fillText(timeText, cursorX, centerY)
  }

  ctx.restore()
}

function ellipsizeToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo) + ellipsis
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

interface LegendExportItem {
  title: string
  image: HTMLImageElement
}

const LEGEND_STRIP_PAD = 16
const LEGEND_CARD_PAD = 10
const LEGEND_CARD_GAP = 8
const LEGEND_TITLE_PX = 13
const LEGEND_TITLE_GAP = 6
const LEGEND_IMAGE_MAX_H = 110

async function loadLegendImages(
  layers: ReadonlyArray<ParsedLayer>,
  pinned: ReadonlySet<string>,
  baseUrl: string,
): Promise<ReadonlyArray<LegendExportItem>> {
  const items: Array<{ title: string; url: string }> = []
  for (const name of pinned) {
    const layer = layers.find((l) => l.name === name)
    const url = layer?.styles[0]?.legendUrl
    if (!layer || !url) continue
    items.push({ title: layer.title, url: rebaseLensUrl(url, baseUrl) })
  }
  const loaded = await Promise.all(
    items.map(
      (it) =>
        new Promise<LegendExportItem | null>((resolve) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve({ title: it.title, image: img })
          img.onerror = () => resolve(null)
          img.src = it.url
        }),
    ),
  )
  return loaded.filter((x): x is LegendExportItem => x !== null)
}

// Pick column count to mirror the visual grid logic in PinnedLegendsBar.
function legendCols(n: number): number {
  if (n === 1) return 1
  if (n === 2 || n === 4) return 2
  if (n === 3) return 3
  return 3
}

function measureLegendStrip(
  items: ReadonlyArray<LegendExportItem>,
  canvasWidth: number,
  dpr: number,
): number {
  const cols = legendCols(items.length)
  const rows = Math.ceil(items.length / cols)
  const pad = LEGEND_STRIP_PAD * dpr
  const cardPad = LEGEND_CARD_PAD * dpr
  const gap = LEGEND_CARD_GAP * dpr
  const titlePx = LEGEND_TITLE_PX * dpr
  const titleGap = LEGEND_TITLE_GAP * dpr
  const cardWidth = (canvasWidth - pad * 2 - gap * (cols - 1)) / cols
  // Each legend image is rendered preserving aspect ratio, scaled down to
  // fit the card width, with a hard max height. Take the largest among the
  // items as the row's height (so cards align).
  const innerWidth = cardWidth - cardPad * 2
  let imageH = 0
  for (const item of items) {
    const ar = item.image.height / Math.max(1, item.image.width)
    const h = Math.min(innerWidth * ar, LEGEND_IMAGE_MAX_H * dpr)
    if (h > imageH) imageH = h
  }
  const cardHeight = cardPad * 2 + titlePx + titleGap + imageH
  return pad * 2 + cardHeight * rows + gap * (rows - 1)
}

function drawLegendStrip(
  ctx: CanvasRenderingContext2D,
  items: ReadonlyArray<LegendExportItem>,
  canvasWidth: number,
  yOffset: number,
  dpr: number,
): void {
  const cols = legendCols(items.length)
  const pad = LEGEND_STRIP_PAD * dpr
  const cardPad = LEGEND_CARD_PAD * dpr
  const gap = LEGEND_CARD_GAP * dpr
  const titlePx = LEGEND_TITLE_PX * dpr
  const titleGap = LEGEND_TITLE_GAP * dpr
  const cardWidth = (canvasWidth - pad * 2 - gap * (cols - 1)) / cols
  const innerWidth = cardWidth - cardPad * 2
  let imageH = 0
  for (const item of items) {
    const ar = item.image.height / Math.max(1, item.image.width)
    const h = Math.min(innerWidth * ar, LEGEND_IMAGE_MAX_H * dpr)
    if (h > imageH) imageH = h
  }
  const cardHeight = cardPad * 2 + titlePx + titleGap + imageH
  const radius = 6 * dpr

  // Strip background — soft white with subtle border, matching the live UI
  // pinned-legends bar.
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)'
  ctx.fillRect(
    0,
    yOffset,
    canvasWidth,
    pad * 2 +
      cardHeight * Math.ceil(items.length / cols) +
      gap * (Math.ceil(items.length / cols) - 1),
  )

  ctx.font = `500 ${titlePx}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textBaseline = 'top'

  items.forEach((item, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = pad + col * (cardWidth + gap)
    const y = yOffset + pad + row * (cardHeight + gap)

    // Card outline
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.lineWidth = 1 * dpr
    roundedRectPath(ctx, x, y, cardWidth, cardHeight, radius)
    ctx.fill()
    ctx.stroke()

    // Title (ellipsised to card inner width)
    ctx.fillStyle = '#111'
    ctx.textAlign = 'left'
    const fitTitle = ellipsizeToWidth(ctx, item.title, innerWidth)
    ctx.fillText(fitTitle, x + cardPad, y + cardPad)

    // Image (preserve aspect ratio, centred horizontally)
    const ar = item.image.height / Math.max(1, item.image.width)
    const targetW = Math.min(innerWidth, (LEGEND_IMAGE_MAX_H * dpr) / ar)
    const targetH = targetW * ar
    const imgX = x + cardPad + (innerWidth - targetW) / 2
    const imgY = y + cardPad + titlePx + titleGap + (imageH - targetH) / 2
    ctx.drawImage(item.image, imgX, imgY, targetW, targetH)
  })

  ctx.restore()
}
