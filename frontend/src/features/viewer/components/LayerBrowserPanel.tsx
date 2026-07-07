/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LayerGroup, PartitionedGroups } from '../wms-capabilities'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

// ============================================================
// Layer browser (right sidebar)
// ============================================================

export function LayerBrowserPanel({
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
