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
 * Active-layers panel (left sidebar) for the compare viewer — mirrors the
 * embedded viewer's layout: what's on the map lives on the left, what's
 * available on the right. Hosts the opacity hierarchy:
 * global × per-source (all-of-A / all-of-B) × per-layer, plus per-source
 * legends and removal.
 */

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  Eye,
  EyeOff,
  GripVertical,
  HelpCircle,
  Pin,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { firstNumber } from '../format'
import {
  combineScaleBands,
  rebaseLensUrl,
  scaleBandState,
  scaleBandTargetResolution,
} from '../wms-capabilities'
import { LegendImage } from '../components/LegendImage'
import { SLOT_CHIP_CLASS } from './GeoLayerBrowser'
import { parseGeojsonOverlay } from './overlays'
import type { ScaleBand } from '../wms-capabilities'
import type { ContextOverlay } from './overlays'
import type { MapAnnotation } from './annotations'
import type { PairedLayer, SourceSlot } from './layer-pairing'
import type { CompareSelection } from './useCompareSelection'
import type { LensSource } from '../hooks/useLensSource'
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
}

export interface LegendPins {
  /** Keys `${slot}:${layerName}`. */
  pinned: ReadonlySet<string>
  toggle: (slot: SourceSlot, name: string) => void
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
      className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
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
  resolution,
  onZoomToResolution,
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
  /** Current view resolution (m/px) for scale-band hints; null until known. */
  resolution: number | null
  /** Animate the shared view to a resolution (jump into a layer's band). */
  onZoomToResolution: (res: number) => void
  onCollapse: () => void
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  const pairByKey = new Map(pairs.map((p) => [p.key, p]))
  const activePairs = selection.linkedOrder
    .map((key) => pairByKey.get(key))
    .filter((p): p is PairedLayer => p !== undefined)

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background">
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
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
        {selection.linkMode === 'linked' ? (
          activePairs.length === 0 ? (
            <EmptyHint />
          ) : (
            <ul className="space-y-2">
              {activePairs.map((pair, index) => (
                <ActivePairCard
                  key={pair.key}
                  pair={pair}
                  index={index}
                  onReorder={selection.reorderPair}
                  selection={selection}
                  sources={sources}
                  pins={pins}
                  resolution={resolution}
                  onZoomToResolution={onZoomToResolution}
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
              resolution={resolution}
              onZoomToResolution={onZoomToResolution}
            />
            {sources.b !== null && (
              <ActiveSourceSection
                slot="b"
                selection={selection}
                source={sources.b}
                pins={pins}
                resolution={resolution}
                onZoomToResolution={onZoomToResolution}
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

/** Numbered findings pinned to the map: click to edit, X to remove. */
function AnnotationsSection({
  annotations,
}: {
  annotations: AnnotationControls
}) {
  const { t } = useTranslation('visualise')
  if (annotations.items.length === 0) return null
  return (
    <div className="space-y-1.5 border-t border-border bg-muted/30 px-3 py-2.5">
      <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('annotations.title')}
      </P>
      <ul className="space-y-1">
        {annotations.items.map((annotation, index) => (
          <li key={annotation.id} className="flex items-start gap-1.5">
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white',
                annotation.slot === 'a'
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : annotation.slot === 'b'
                    ? 'bg-orange-600 dark:bg-orange-500'
                    : 'bg-slate-700 dark:bg-slate-500',
              )}
              title={
                annotation.slot
                  ? annotation.slot.toUpperCase()
                  : t('annotations.slotShared')
              }
            >
              {index + 1}
            </span>
            <button
              type="button"
              onClick={() => annotations.edit(annotation.id)}
              className="min-w-0 flex-1 rounded text-left text-xs leading-snug hover:bg-accent"
              title={annotation.text}
            >
              <span className="line-clamp-2">{annotation.text}</span>
            </button>
            <button
              type="button"
              onClick={() => annotations.remove(annotation.id)}
              aria-label={t('annotations.remove', { number: index + 1 })}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                  className="h-5 max-w-24 shrink-0 rounded border border-border bg-background text-[10px] text-muted-foreground"
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
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                'flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
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

/** Linked mode: one card per active PAIR, with both sources' legends. */
function ActivePairCard({
  pair,
  index,
  onReorder,
  selection,
  sources,
  pins,
  resolution,
  onZoomToResolution,
}: {
  pair: PairedLayer
  index: number
  onReorder: (from: number, to: number) => void
  selection: CompareSelection
  sources: { a: PanelSlotSource; b: PanelSlotSource | null }
  pins: LegendPins
  resolution: number | null
  onZoomToResolution: (res: number) => void
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
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
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
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={title}
        >
          {title}
        </P>
        <button
          type="button"
          onClick={() => selection.togglePair(pair.key)}
          aria-label={t('sidebar.removeLayer', { name: title })}
          title={t('sidebar.removeLayer', { name: title })}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ScaleHint
        band={combineScaleBands(
          pair.perSource.a?.scale,
          pair.perSource.b?.scale,
        )}
        resolution={resolution}
        onZoomTo={onZoomToResolution}
      />
      <label className="mt-2 block">
        <span className="sr-only">{`${title} opacity`}</span>
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
      <div className="mt-2 space-y-1.5">
        {(['a', 'b'] as const).flatMap((slot) => {
          const slotSource = sources[slot]
          const layer = pair.perSource[slot]
          const legendUrl = layer?.styles[0]?.legendUrl
          if (!slotSource || !layer || !legendUrl) return []
          return [
            <div key={slot} className="flex items-start gap-1.5">
              {sources.b !== null && (
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
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
  resolution,
  onZoomToResolution,
}: {
  slot: SourceSlot
  selection: CompareSelection
  source: PanelSlotSource
  pins: LegendPins
  resolution: number | null
  onZoomToResolution: (res: number) => void
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
            'flex h-4 w-4 items-center justify-center rounded font-mono text-[10px] font-bold',
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
            const legendUrl = layer?.styles[0]?.legendUrl
            return (
              <li
                key={name}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverIndex(index)
                }}
                onDragLeave={() => setOverIndex(null)}
                onDrop={(e) => {
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
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    title={title}
                  >
                    {title}
                  </P>
                  <button
                    type="button"
                    onClick={() => selection.toggleLayer(slot, name)}
                    aria-label={t('sidebar.removeLayer', { name: title })}
                    title={t('sidebar.removeLayer', { name: title })}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <ScaleHint
                  band={layer?.scale}
                  resolution={resolution}
                  onZoomTo={onZoomToResolution}
                />
                <label className="mt-2 block">
                  <span className="sr-only">{`${title} opacity`}</span>
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
