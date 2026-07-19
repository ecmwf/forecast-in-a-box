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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  Globe2,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import 'ol/ol.css'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import {
  expandTimeSteps,
  rebaseLensUrl,
} from '@/features/viewer/wms-capabilities'
import {
  DEFAULT_BASEMAP_ID,
  DEFAULT_LAYER_OPACITY,
} from '@/features/viewer/ol-layers'
import { firstNumber, formatLatLon } from '@/features/viewer/format'
import { exportMapPng, loadLegendImages } from '@/features/viewer/map-export'
import { useLensSource } from '@/features/viewer/hooks/useLensSource'
import { useTimeStepPrefetch } from '@/features/viewer/hooks/useTimeStepPrefetch'
import { useOlMapBase } from '@/features/viewer/hooks/useOlMapBase'
import { useBasemap } from '@/features/viewer/hooks/useBasemap'
import { useWmsLayerStack } from '@/features/viewer/hooks/useWmsLayerStack'
import { usePointerReadout } from '@/features/viewer/hooks/usePointerReadout'
import { ActiveLayersPanel } from '@/features/viewer/components/ActiveLayersPanel'
import { CollapsedSidebarHandle } from '@/features/viewer/components/CollapsedSidebarHandle'
import { LayerBrowserPanel } from '@/features/viewer/components/LayerBrowserPanel'
import { MapTitleBar } from '@/features/viewer/components/MapTitleBar'
import { PinnedLegendsBar } from '@/features/viewer/components/PinnedLegendsBar'
import { WmsOverviewPanel } from '@/features/viewer/components/WmsOverviewPanel'
import { showToast } from '@/lib/toast'
import { copyToClipboard } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { P } from '@/components/base/typography'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('WmsViewer')

interface WmsViewerProps {
  /** Absolute base URL of the lens, e.g. `http://127.0.0.1:51234`. */
  baseUrl: string
}

// ============================================================
// Main component
// ============================================================

export default function WmsViewer({ baseUrl }: WmsViewerProps) {
  const { t } = useTranslation('executions')
  const containerRef = useRef<HTMLDivElement>(null)

  // Tile-load counter drives the toolbar spinner. Clamped at 0 because
  // canceled tiles can swallow the end event.
  const [tilesLoadingCount, setTilesLoadingCount] = useState(0)
  const tilesLoading = tilesLoadingCount > 0
  const incLoading = useCallback(() => setTilesLoadingCount((c) => c + 1), [])
  const decLoading = useCallback(
    () => setTilesLoadingCount((c) => Math.max(0, c - 1)),
    [],
  )

  // -------- Capabilities (per-source state) --------

  const {
    layers,
    decorationLayers,
    bbox,
    error,
    loadingLayers,
    retrying,
    partitioned,
    allLevels,
    retry: onRetryCapabilities,
  } = useLensSource(baseUrl)

  // Selection: ordered list (index 0 = top of stack) + per-layer opacity.
  // A layer's *visibility* is implicit (in the array = visible).
  const [activeOrder, setActiveOrder] = useState<Array<string>>([])
  const [layerOpacities, setLayerOpacities] = useState<Map<string, number>>(
    new Map(),
  )
  const [masterOpacity, setMasterOpacity] = useState(1)

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

  // -------- OL setup + lifecycle --------

  const { mapRef, basemapLayerRef, tryFit, setFitBbox } = useOlMapBase(
    containerRef,
    { resetKey: baseUrl, incLoading, decLoading },
  )

  useEffect(() => {
    setFitBbox(bbox)
  }, [bbox, setFitBbox])

  const [basemapId, setBasemapId] = useState<string>(DEFAULT_BASEMAP_ID)
  const [basemapOpacity, setBasemapOpacity] = useState(1)
  const { availableBasemaps } = useBasemap({
    mapRef,
    basemapLayerRef,
    baseUrl,
    decorationLayers,
    basemapId,
    opacity: basemapOpacity,
    incLoading,
    decLoading,
  })

  // -------- WMS layer rendering --------

  const resolveTime = useCallback(
    (layer: ParsedLayer) => (layer.time && activeTime ? activeTime : null),
    [activeTime],
  )
  useWmsLayerStack(mapRef, baseUrl, layers, {
    masterOpacity,
    activeOrder,
    layerOpacities,
    resolveTime,
    incLoading,
    decLoading,
  })

  // -------- Time-step prefetch (default off — bandwidth-heavy) --------
  const [preloadTimeSteps, setPreloadTimeSteps] = useState(false)
  useTimeStepPrefetch(mapRef, {
    enabled: preloadTimeSteps,
    baseUrl,
    layers,
    activeOrder,
    timeSteps,
  })

  // -------- Pointer read-out --------

  const pointer = usePointerReadout(mapRef)

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

  const exportPng = useCallback(async (): Promise<Blob | null> => {
    const map = mapRef.current
    if (!map) return null
    const titles = activeOrder
      .map((name) => layers.find((l) => l.name === name)?.title)
      .filter((title): title is string => !!title)
    const legendItems = await loadLegendImages(layers, pinnedLegends, baseUrl)
    return exportMapPng(map, {
      titles,
      activeTime,
      titleBarEnabled,
      legendItems,
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

  const copyMap = useCallback(() => {
    // Unawaited promise: the item must be built inside the gesture (Safari).
    copyToClipboard('image/png', exportPng())
      .then(() => showToast.success(t('lens.mapCopied')))
      .catch((err: unknown) => {
        log.error('Map copy failed', { error: err })
        showToast.error(t('lens.mapCopyFailed'))
      })
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
                {availableBasemaps.map((b) => (
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
              <label className="mt-1 block space-y-1 border-t border-border px-2 pt-2 pb-1">
                <span className="flex items-center justify-between text-xs text-muted-foreground">
                  {t('lens.basemapOpacity')}
                  <span className="font-mono tabular-nums">
                    {Math.round(basemapOpacity * 100)}%
                  </span>
                </span>
                <Slider
                  value={[Math.round(basemapOpacity * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) => setBasemapOpacity(firstNumber(v) / 100)}
                />
              </label>
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
            items={Array.from(pinnedLegends).flatMap((name) => {
              const layer = layers.find((l) => l.name === name)
              const legendUrl = layer?.styles[0]?.legendUrl
              if (!layer || !legendUrl) return []
              return [
                {
                  key: name,
                  title: layer.title,
                  url: rebaseLensUrl(legendUrl, baseUrl),
                },
              ]
            })}
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
