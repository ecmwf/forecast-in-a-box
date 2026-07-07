/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import {
  ChevronDown,
  Info,
  Layers,
  Loader2,
  Map as MapIcon,
  Plus,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LayerGroup, PartitionedGroups } from '../wms-capabilities'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { P } from '@/components/base/typography'

// ============================================================
// Empty-state overview panel
// ============================================================

export function WmsOverviewPanel({
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
