/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import {
  ChevronLeft,
  GripVertical,
  HelpCircle,
  Pin,
  SwatchBook,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber } from '../format'
import { DEFAULT_LAYER_OPACITY } from '../ol-layers'
import { rebaseLensUrl } from '../wms-capabilities'
import { LegendImage } from './LegendImage'
import { TimeSlider } from './TimeSlider'
import type { ParsedLayer } from '../wms-capabilities'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

// ============================================================
// Active layers panel (left sidebar)
// ============================================================

export function ActiveLayersPanel({
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
        {/* Decorative grip — drag is initiated by the parent draggable div.
            No keyboard reorder path; mouse/touch-only by design. */}
        <span
          aria-hidden="true"
          title={t('lens.dragHandle')}
          className="text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </span>
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
