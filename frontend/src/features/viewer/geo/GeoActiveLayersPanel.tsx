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
 * Active-layers panel (left sidebar) for the compare viewer: what's on
 * the map lives on the left, what's available on the right. Hosts the
 * opacity hierarchy:
 * global × per-source (all-of-A / all-of-B) × per-layer, plus per-source
 * legends and removal.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  HelpCircle,
  Pencil,
  Pin,
  TimerOff,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { firstNumber } from '../format'
import {
  RUN_DIMENSION,
  combineScaleBands,
  isLensProxyUrl,
  legendStripUrl,
  rebaseLensUrl,
  resolveStyle,
  scaleBandState,
  scaleBandTargetResolution,
} from '../wms-capabilities'
import { stylePreviewUrl } from '../style-preview'
import { LegendImage } from '../components/LegendImage'
import { LayerStylePicker } from './LayerStylePicker'
import { LayerRunSelect } from './LayerRunSelect'
import { SLOT_CHIP_CLASS } from './GeoLayerBrowser'
import { parseGeojsonOverlay } from './overlays'
import { ANNOTATION_COLORS, downloadAnnotationsGeojson } from './annotations'
import { layerIsTimeAware, pairIsStatic } from './layer-pairing'
import type { ParsedLayer, ScaleBand } from '../wms-capabilities'
import type { ContextOverlay } from './overlays'
import type { MapAnnotation } from './annotations'
import type { PairedLayer, SourceSlot } from './layer-pairing'
import type { CompareSelection } from './useCompareSelection'
import type { LensSource } from '../hooks/useLensSource'
import type { BboxAxisOrder } from '../projections'
import type { PreviewFrame } from '../style-preview'
import type { StyleOption } from './LayerStylePicker'
import type View from 'ol/View'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'
import { TOUR, tourAttr } from '@/features/tutorials/anchors'
import { cn } from '@/lib/utils'

const log = createLogger('GeoActiveLayersPanel')

export interface OverlayControls {
  items: ReadonlyArray<ContextOverlay>
  add: (overlay: ContextOverlay) => void
  toggle: (id: string) => void
  remove: (id: string) => void
  setLabel: (id: string, labelProperty: string | null) => void
}

export interface AnnotationControls {
  items: ReadonlyArray<MapAnnotation>
  edit: (id: string) => void
  remove: (id: string) => void
  /** Pan the shared view to a pin (sidebar row click). */
  locate: (id: string) => void
  /** Echo sidebar-row hover as an enlarged pin; null clears. */
  setHighlight: (id: string | null) => void
  /** Where the pin's source is shown now ("A", "A · B", shared, hidden). */
  attribution: (annotation: MapAnnotation) => string
}

export interface OpacityTiers {
  global: number
  setGlobal: (v: number) => void
  source: Record<SourceSlot, number>
  setSource: (slot: SourceSlot, v: number) => void
}

export interface PanelSlotSource {
  label: string
  baseUrl: string
  lens: LensSource
  /** Raw TIME string this server advertised for the current instant. */
  resolveTime: (layer: ParsedLayer) => string | null
  bboxAxisOrder: BboxAxisOrder
}

/** Pinned default style per side and layer (persisted). */
export interface StylePins {
  pinnedFor: (slot: SourceSlot, layerName: string) => string | null
  setPin: (slot: SourceSlot, layerName: string, style: string | null) => void
}

export interface LegendPins {
  /** Keys `${slot}:${layerName}`. */
  pinned: ReadonlySet<string>
  toggle: (slot: SourceSlot, name: string) => void
}

/** Style picker for one card: the union of the sides' styles by name. */
function StylePickerFor({
  title,
  entries,
  value,
  onChange,
  showSlots,
  view,
  stylePins,
}: {
  title: string
  entries: ReadonlyArray<{
    slot: SourceSlot
    layer: ParsedLayer
    source: PanelSlotSource
    /** This side's dimension values, so previews match. */
    dims?: Readonly<Record<string, string>>
  }>
  value: string | null
  onChange: (name: string | null) => void
  showSlots: boolean
  view: View
  stylePins: StylePins
}) {
  const options = useMemo(() => {
    const byName = new Map<string, StyleOption>()
    for (const { slot, layer, source } of entries) {
      for (const style of layer.styles) {
        const option = byName.get(style.name) ?? {
          name: style.name,
          title: style.title ?? style.name,
          abstract: style.abstract,
          slots: [],
          strip: {},
          legend: {},
        }
        option.slots = [...option.slots, slot]
        const strip = legendStripUrl(style, 256)
        if (strip) option.strip[slot] = rebaseLensUrl(strip, source.baseUrl)
        if (style.legendUrl) {
          option.legend[slot] = rebaseLensUrl(style.legendUrl, source.baseUrl)
        }
        byName.set(style.name, option)
      }
    }
    return [...byName.values()]
  }, [entries])
  const previewUrl = useCallback(
    (name: string, slot: SourceSlot, frame: PreviewFrame) => {
      const entry = entries.find((e) => e.slot === slot)
      if (!entry) return null
      return stylePreviewUrl(
        {
          baseUrl: entry.source.baseUrl,
          layer: entry.layer,
          settings: { style: name, dims: entry.dims },
          time: entry.source.resolveTime(entry.layer),
          bboxAxisOrder: entry.source.bboxAxisOrder,
        },
        view,
        frame,
      )
    },
    [entries, view],
  )
  if (options.length < 2) return null
  // The lens renders a thumbnail in ~0.1 s; public servers get gentler.
  const lensOnly = entries.every((e) => isLensProxyUrl(e.source.baseUrl))
  const pinned =
    entries
      .map((e) => stylePins.pinnedFor(e.slot, e.layer.name))
      .find((p): p is string => p !== null) ?? null
  const onPin = (name: string | null) => {
    for (const e of entries) {
      const has = name === null || e.layer.styles.some((s) => s.name === name)
      if (has) stylePins.setPin(e.slot, e.layer.name, name)
    }
  }
  return (
    <LayerStylePicker
      layerTitle={title}
      options={options}
      value={value}
      onChange={onChange}
      showSlots={showSlots}
      view={view}
      previewUrl={previewUrl}
      prefetchConcurrency={lensOnly ? 4 : 2}
      pinned={pinned}
      onPin={onPin}
    />
  )
}

/** Pin/unpin button next to a legend. */
function PinButton({
  pins,
  slot,
  name,
}: {
  pins: LegendPins
  slot: SourceSlot
  name: string
}) {
  const { t } = useTranslation('executions')
  const pinned = pins.pinned.has(`${slot}:${name}`)
  return (
    <Button
      variant={pinned ? 'default' : 'ghost'}
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={() => pins.toggle(slot, name)}
      aria-pressed={pinned}
      title={pinned ? t('lens.unpinLegend') : t('lens.pinLegend')}
      aria-label={pinned ? t('lens.unpinLegend') : t('lens.pinLegend')}
    >
      <Pin className="h-3.5 w-3.5" />
    </Button>
  )
}

/** Scale-limited layer affordance: muted badge in range, amber "zoom to reveal" out of range. */
function ScaleHint({
  band,
  resolution,
  onZoomTo,
}: {
  band: ScaleBand | undefined
  resolution: number | null
  onZoomTo: (res: number) => void
}) {
  const { t } = useTranslation('visualise')
  if (!band) return null
  const state =
    resolution === null ? 'in-range' : scaleBandState(band, resolution)
  if (state === 'in-range') {
    return (
      <span
        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
        title={t('scale.dependentHint')}
      >
        <ZoomIn className="h-3 w-3" />
        {t('scale.dependent')}
      </span>
    )
  }
  const Icon = state === 'zoom-in' ? ZoomIn : ZoomOut
  return (
    <button
      type="button"
      onClick={() => onZoomTo(scaleBandTargetResolution(band))}
      title={t('scale.outOfRangeHint')}
      className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
    >
      <Icon className="h-3 w-3" />
      {state === 'zoom-in'
        ? t('scale.zoomInToReveal')
        : t('scale.zoomOutToReveal')}
    </button>
  )
}

export function GeoActiveLayersPanel({
  pairs,
  selection,
  opacity,
  sources,
  overlays,
  annotations,
  preload,
  pins,
  stylePins,
  resolution,
  onZoomToResolution,
  previewView,
  focusSlot,
  onCollapse,
}: {
  pairs: ReadonlyArray<PairedLayer>
  selection: CompareSelection
  opacity: OpacityTiers
  /** `b: null` = solo — per-source tiers and slot chips are hidden. */
  sources: { a: PanelSlotSource; b: PanelSlotSource | null }
  overlays: OverlayControls
  annotations: AnnotationControls
  preload: {
    enabled: boolean
    setEnabled: (v: boolean) => void
    available: boolean
  }
  pins: LegendPins
  stylePins: StylePins
  /** Current view resolution (m/px) for scale-band hints; null until known. */
  resolution: number | null
  /** Animate the shared view to a resolution (jump into a layer's band). */
  onZoomToResolution: (res: number) => void
  /** The live map View — style previews render its current extent. */
  previewView: View
  /** View only one source: hide the other's section and per-source tiers. */
  focusSlot: SourceSlot | null
  onCollapse: () => void
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  const pairByKey = new Map(pairs.map((p) => [p.key, p]))
  const activePairs = selection.linkedOrder
    .map((key) => pairByKey.get(key))
    .filter((p): p is PairedLayer => p !== undefined)
  const focusedSource =
    focusSlot === 'a' ? sources.a : focusSlot === 'b' ? sources.b : null

  // Width steps mirror GeoLayerBrowser — the sidebars stay symmetric.
  return (
    <aside
      data-geo-panel="left"
      {...tourAttr(TOUR.visualise.activeLayers)}
      className="flex w-72 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background lg:w-[var(--geo-left-w,15rem)] xl:w-[var(--geo-left-w,18rem)]"
    >
      <div className="space-y-2.5 border-b border-border bg-muted/40 px-3 pt-2.5 pb-3">
        <div className="flex items-center justify-between">
          <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('sidebar.active')}
          </P>
          <button
            type="button"
            onClick={onCollapse}
            title={tExec('lens.collapseSidebar')}
            aria-label={tExec('lens.collapseSidebar')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <OpacityRow
          label={t('sidebar.globalOpacity')}
          value={opacity.global}
          onChange={opacity.setGlobal}
        />
        {sources.b !== null &&
          focusSlot === null &&
          (['a', 'b'] as const).map((slot) => (
            <OpacityRow
              key={slot}
              label={t('sidebar.sourceOpacity', { slot: slot.toUpperCase() })}
              slot={slot}
              value={opacity.source[slot]}
              onChange={(v) => opacity.setSource(slot, v)}
            />
          ))}
        {preload.available && (
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              {tExec('lens.preloadTimeSteps')}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={tExec('lens.preloadHelp')}
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
                  {tExec('lens.preloadTimeStepsHelp')}
                </TooltipContent>
              </Tooltip>
            </span>
            <Switch
              size="sm"
              checked={preload.enabled}
              onCheckedChange={preload.setEnabled}
            />
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {focusSlot !== null && focusedSource !== null ? (
          <ActiveSourceSection
            slot={focusSlot}
            selection={selection}
            source={focusedSource}
            pins={pins}
            stylePins={stylePins}
            resolution={resolution}
            onZoomToResolution={onZoomToResolution}
            view={previewView}
          />
        ) : selection.linkMode === 'linked' ? (
          activePairs.length === 0 ? (
            <EmptyHint />
          ) : (
            <ul className="space-y-2">
              {activePairs.map((pair, index) => (
                <ActivePairCard
                  key={pair.key}
                  pair={pair}
                  index={index}
                  count={activePairs.length}
                  onReorder={selection.reorderPair}
                  selection={selection}
                  sources={sources}
                  pins={pins}
                  stylePins={stylePins}
                  resolution={resolution}
                  onZoomToResolution={onZoomToResolution}
                  view={previewView}
                />
              ))}
            </ul>
          )
        ) : (
          <>
            <ActiveSourceSection
              slot="a"
              selection={selection}
              source={sources.a}
              pins={pins}
              stylePins={stylePins}
              resolution={resolution}
              onZoomToResolution={onZoomToResolution}
              view={previewView}
            />
            {sources.b !== null && (
              <ActiveSourceSection
                slot="b"
                selection={selection}
                source={sources.b}
                pins={pins}
                stylePins={stylePins}
                resolution={resolution}
                onZoomToResolution={onZoomToResolution}
                view={previewView}
              />
            )}
          </>
        )}
      </div>

      <AnnotationsSection annotations={annotations} />
      <OverlaysSection overlays={overlays} />
    </aside>
  )
}

/** Numbered findings: hover highlights the pin, row click pans to it,
 *  pencil edits, X removes; download here, import via the toolbar menu. */
function AnnotationsSection({
  annotations,
}: {
  annotations: AnnotationControls
}) {
  const { t } = useTranslation('visualise')
  if (annotations.items.length === 0) return null
  return (
    <div className="space-y-1.5 border-t border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('annotations.title')}
        </P>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => downloadAnnotationsGeojson(annotations.items)}
          title={t('annotations.export')}
          aria-label={t('annotations.export')}
        >
          <Download className="h-3 w-3" />
        </Button>
      </div>
      <ul className="space-y-1">
        {annotations.items.map((annotation) => (
          <li
            key={annotation.id}
            className="group flex items-start gap-1.5"
            onMouseEnter={() => annotations.setHighlight(annotation.id)}
            onMouseLeave={() => annotations.setHighlight(null)}
          >
            <span
              className="mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-0.5 font-mono text-[10px] font-bold text-white"
              style={{ backgroundColor: ANNOTATION_COLORS[annotation.color] }}
              title={annotations.attribution(annotation)}
            >
              {annotation.label}
            </span>
            <button
              type="button"
              onClick={() => annotations.locate(annotation.id)}
              className="min-w-0 flex-1 rounded-md text-left text-xs leading-snug hover:bg-accent"
              title={t('annotations.locate', { label: annotation.label })}
            >
              <span className="line-clamp-2">{annotation.text}</span>
            </button>
            <button
              type="button"
              onClick={() => annotations.edit(annotation.id)}
              aria-label={t('annotations.edit', { label: annotation.label })}
              title={t('annotations.edit', { label: annotation.label })}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => annotations.remove(annotation.id)}
              aria-label={t('annotations.remove', { label: annotation.label })}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Uploaded GeoJSON context overlays: upload, visibility, removal. */
function OverlaysSection({ overlays }: { overlays: OverlayControls }) {
  const { t } = useTranslation('visualise')
  const inputRef = useRef<HTMLInputElement>(null)

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      overlays.add(parseGeojsonOverlay(file.name, text))
    } catch (err) {
      log.error('GeoJSON overlay parse failed', { error: err })
      showToast.error(t('overlays.invalid'))
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('overlays.title')}
        </P>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3 w-3" />
          {t('overlays.upload')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.geojson,application/geo+json,application/json"
          className="hidden"
          aria-label={t('overlays.upload')}
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      {overlays.items.length > 0 && (
        <ul className="space-y-1">
          {overlays.items.map((overlay) => (
            <li key={overlay.id} className="flex items-center gap-1.5 text-sm">
              <button
                type="button"
                onClick={() => overlays.toggle(overlay.id)}
                aria-pressed={overlay.visible}
                aria-label={
                  overlay.visible
                    ? t('overlays.hide', { name: overlay.name })
                    : t('overlays.show', { name: overlay.name })
                }
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {overlay.visible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </button>
              <span
                className="min-w-0 flex-1 truncate text-xs"
                title={overlay.name}
              >
                {overlay.name}
                <span className="ml-1 text-muted-foreground">
                  {t('overlays.features', { count: overlay.featureCount })}
                </span>
              </span>
              {overlay.propertyKeys.length > 0 && (
                <select
                  value={overlay.labelProperty ?? ''}
                  aria-label={t('overlays.labelAria', { name: overlay.name })}
                  title={t('overlays.labelAria', { name: overlay.name })}
                  onChange={(e) =>
                    overlays.setLabel(overlay.id, e.target.value || null)
                  }
                  className="h-5 max-w-24 shrink-0 rounded-md border border-border bg-background text-[10px] text-muted-foreground"
                >
                  <option value="">{t('overlays.labelNone')}</option>
                  {overlay.propertyKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => overlays.remove(overlay.id)}
                aria-label={t('overlays.remove', { name: overlay.name })}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyHint() {
  const { t } = useTranslation('visualise')
  return (
    <P className="p-2 text-sm text-muted-foreground">{t('sidebar.empty')}</P>
  )
}

function OpacityRow({
  label,
  value,
  onChange,
  slot,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  slot?: SourceSlot
}) {
  // <label> wraps the slider so its text names the range input (the
  // element carrying role=slider) — aria-label on the styled root is a
  // div and never reaches it.
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {slot && (
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold',
                SLOT_CHIP_CLASS[slot],
              )}
            >
              {slot.toUpperCase()}
            </span>
          )}
          <span className="truncate">{label}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {Math.round(value * 100)}%
        </span>
      </span>
      <Slider
        value={[Math.round(value * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={(v) => onChange(firstNumber(v) / 100)}
      />
    </label>
  )
}

/** Keyboard/touch path for the drag-reorder: nudge a row one step. */
function MoveButtons({
  name,
  index,
  count,
  onMove,
}: {
  name: string
  index: number
  count: number
  onMove: (from: number, to: number) => void
}) {
  const { t } = useTranslation('visualise')
  return (
    <>
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        aria-label={t('sidebar.moveLayerUp', { name })}
        title={t('sidebar.moveLayerUp', { name })}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
        aria-label={t('sidebar.moveLayerDown', { name })}
        title={t('sidebar.moveLayerDown', { name })}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </>
  )
}

/** Linked mode: one card per active PAIR, with both sources' legends. */
function ActivePairCard({
  pair,
  index,
  count,
  onReorder,
  selection,
  sources,
  pins,
  stylePins,
  resolution,
  onZoomToResolution,
  view,
}: {
  pair: PairedLayer
  index: number
  count: number
  onReorder: (from: number, to: number) => void
  selection: CompareSelection
  sources: { a: PanelSlotSource; b: PanelSlotSource | null }
  pins: LegendPins
  stylePins: StylePins
  resolution: number | null
  onZoomToResolution: (res: number) => void
  view: View
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  const [over, setOver] = useState(false)
  const title =
    pair.level !== null
      ? `${pair.title} · ${pair.level} ${pair.levelUnit ?? 'hPa'}`
      : pair.title

  return (
    <li
      onDragOver={(e) => {
        // Only our pair drags — a foreign drop reads as "move index 0".
        if (!e.dataTransfer.types.includes('text/x-compare-pair')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('text/x-compare-pair')) return
        e.preventDefault()
        setOver(false)
        const from = Number(e.dataTransfer.getData('text/x-compare-pair'))
        if (Number.isInteger(from)) onReorder(from, index)
      }}
      className={cn(
        'rounded-md border bg-card p-2.5 transition-colors',
        over ? 'border-primary' : 'border-border',
      )}
    >
      {/* Header initiates drags; the slider below is excluded so its
          pointer events reach Base UI's gesture handler. */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/x-compare-pair', String(index))
          e.dataTransfer.effectAllowed = 'move'
        }}
        className="flex cursor-grab items-start gap-2 active:cursor-grabbing"
      >
        <span
          aria-hidden="true"
          title={tExec('lens.dragHandle')}
          className="text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <P
          className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-medium break-words"
          title={title}
        >
          {title}
        </P>
        <MoveButtons
          name={title}
          index={index}
          count={count}
          onMove={onReorder}
        />
        <button
          type="button"
          onClick={() => selection.togglePair(pair.key)}
          aria-label={t('sidebar.removeLayer', { name: title })}
          title={t('sidebar.removeLayer', { name: title })}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {pairIsStatic(pair) && (
        <span
          className="mt-1.5 mr-2 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
          title={t('timeline.staticLayerHint')}
        >
          <TimerOff className="h-3 w-3" />
          {t('timeline.staticBadge')}
        </span>
      )}
      <ScaleHint
        band={combineScaleBands(
          pair.perSource.a?.scale,
          pair.perSource.b?.scale,
        )}
        resolution={resolution}
        onZoomTo={onZoomToResolution}
      />
      <label className="mt-2 block">
        <span className="sr-only">
          {t('sidebar.layerOpacity', { name: title })}
        </span>
        <Slider
          value={[Math.round(selection.pairOpacity(pair.key) * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) =>
            selection.setPairOpacity(pair.key, firstNumber(v) / 100)
          }
        />
      </label>
      {(['a', 'b'] as const).map((slot) => {
        const layer = pair.perSource[slot]
        if (!layer || !sources[slot]) return null
        return (
          <LayerRunSelect
            key={slot}
            slot={slot}
            layer={layer}
            title={title}
            value={selection.layerDim(slot, layer.name, RUN_DIMENSION)}
            onChange={(run) =>
              selection.setLayerDim(slot, layer.name, RUN_DIMENSION, run)
            }
            showSlot={sources.b !== null}
          />
        )
      })}
      <StylePickerFor
        title={title}
        entries={(['a', 'b'] as const).flatMap((slot) => {
          const layer = pair.perSource[slot]
          const source = sources[slot]
          if (!layer || !source) return []
          const dims = selection.settingsFor(slot).get(layer.name)?.dims
          return [{ slot, layer, source, dims }]
        })}
        value={selection.pairStyle(pair.key)}
        onChange={(name) => selection.setPairStyle(pair.key, name)}
        showSlots={sources.b !== null}
        view={view}
        stylePins={stylePins}
      />
      <div className="mt-2 space-y-1.5">
        {(['a', 'b'] as const).flatMap((slot) => {
          const slotSource = sources[slot]
          const layer = pair.perSource[slot]
          const legendUrl = layer
            ? resolveStyle(
                layer,
                selection.settingsFor(slot).get(layer.name)?.style,
              )?.legendUrl
            : undefined
          if (!slotSource || !layer || !legendUrl) return []
          return [
            <div key={slot} className="flex items-start gap-1.5">
              {sources.b !== null && (
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold',
                    SLOT_CHIP_CLASS[slot],
                  )}
                >
                  {slot.toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <LegendImage
                  url={rebaseLensUrl(legendUrl, slotSource.baseUrl)}
                  title={`${title} (${slot.toUpperCase()})`}
                />
              </div>
              <PinButton pins={pins} slot={slot} name={layer.name} />
            </div>,
          ]
        })}
      </div>
    </li>
  )
}

/** Unlinked mode: per-source active layer cards. */
function ActiveSourceSection({
  slot,
  selection,
  source,
  pins,
  stylePins,
  resolution,
  onZoomToResolution,
  view,
}: {
  slot: SourceSlot
  selection: CompareSelection
  source: PanelSlotSource
  pins: LegendPins
  stylePins: StylePins
  resolution: number | null
  onZoomToResolution: (res: number) => void
  view: View
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const { lens, baseUrl, label } = source
  const activeNames = selection.activeOrderFor(slot)
  const dragMime = `text/x-compare-layer-${slot}`

  return (
    <section>
      <P className="flex items-center gap-1.5 px-1 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-md font-mono text-[10px] font-bold',
            SLOT_CHIP_CLASS[slot],
          )}
        >
          {slot.toUpperCase()}
        </span>
        <span className="truncate">{label}</span>
      </P>
      {activeNames.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="space-y-2">
          {activeNames.map((name, index) => {
            const layer = lens.layers.find((l) => l.name === name)
            const title = layer?.title ?? name
            const legendUrl = layer
              ? resolveStyle(layer, selection.layerStyle(slot, name))?.legendUrl
              : undefined
            return (
              <li
                key={name}
                onDragOver={(e) => {
                  // Only THIS slot's drags — an A card must not drop on B.
                  if (!e.dataTransfer.types.includes(dragMime)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverIndex(index)
                }}
                onDragLeave={() => setOverIndex(null)}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(dragMime)) return
                  e.preventDefault()
                  setOverIndex(null)
                  const from = Number(e.dataTransfer.getData(dragMime))
                  if (Number.isInteger(from)) {
                    selection.reorderLayer(slot, from, index)
                  }
                }}
                className={cn(
                  'rounded-md border bg-card p-2.5 transition-colors',
                  overIndex === index ? 'border-primary' : 'border-border',
                )}
              >
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(dragMime, String(index))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  className="flex cursor-grab items-start gap-2 active:cursor-grabbing"
                >
                  <span
                    aria-hidden="true"
                    title={tExec('lens.dragHandle')}
                    className="text-muted-foreground"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <P
                    className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-medium break-words"
                    title={title}
                  >
                    {title}
                  </P>
                  <MoveButtons
                    name={title}
                    index={index}
                    count={activeNames.length}
                    onMove={(from, to) =>
                      selection.reorderLayer(slot, from, to)
                    }
                  />
                  <button
                    type="button"
                    onClick={() => selection.toggleLayer(slot, name)}
                    aria-label={t('sidebar.removeLayer', { name: title })}
                    title={t('sidebar.removeLayer', { name: title })}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {layer !== undefined && !layerIsTimeAware(layer) && (
                  <span
                    className="mt-1.5 mr-2 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
                    title={t('timeline.staticLayerHint')}
                  >
                    <TimerOff className="h-3 w-3" />
                    {t('timeline.staticBadge')}
                  </span>
                )}
                <ScaleHint
                  band={layer?.scale}
                  resolution={resolution}
                  onZoomTo={onZoomToResolution}
                />
                <label className="mt-2 block">
                  <span className="sr-only">
                    {t('sidebar.layerOpacity', { name: title })}
                  </span>
                  <Slider
                    value={[
                      Math.round(selection.layerOpacity(slot, name) * 100),
                    ]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) =>
                      selection.setLayerOpacity(
                        slot,
                        name,
                        firstNumber(v) / 100,
                      )
                    }
                  />
                </label>
                {layer && (
                  <LayerRunSelect
                    slot={slot}
                    layer={layer}
                    title={title}
                    value={selection.layerDim(slot, name, RUN_DIMENSION)}
                    onChange={(run) =>
                      selection.setLayerDim(slot, name, RUN_DIMENSION, run)
                    }
                    showSlot={false}
                  />
                )}
                {layer && (
                  <StylePickerFor
                    title={title}
                    entries={[
                      {
                        slot,
                        layer,
                        source,
                        dims: selection.settingsFor(slot).get(name)?.dims,
                      },
                    ]}
                    value={selection.layerStyle(slot, name)}
                    onChange={(s) => selection.setLayerStyle(slot, name, s)}
                    showSlots={false}
                    view={view}
                    stylePins={stylePins}
                  />
                )}
                {legendUrl && (
                  <div className="mt-2 flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      <LegendImage
                        url={rebaseLensUrl(legendUrl, baseUrl)}
                        title={title}
                      />
                    </div>
                    <PinButton pins={pins} slot={slot} name={name} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
