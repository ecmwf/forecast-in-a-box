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
 * Available-layers browser (right sidebar) for the compare viewer, using
 * the embedded viewer's proven structure: search, surface / pressure-level
 * sections, collapsible multi-level parameter groups, and a pressure-level
 * filter — plus, compare-specific: an All | A | B availability filter and
 * per-entry slot chips. Browse-only; the active selection is managed in
 * the left panel (GeoActiveLayersPanel).
 */

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  List,
  ListTree,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { groupPairs } from './pair-grouping'
import { groupByTitlePrefix } from './title-grouping'
import type { SlotFilter } from './pair-grouping'
import type { PairedLayer, SourceSlot } from './layer-pairing'
import type { CompareSelection } from './useCompareSelection'
import type { LensSource } from '../hooks/useLensSource'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

export const SLOT_CHIP_CLASS: Record<SourceSlot, string> = {
  a: 'bg-blue-600/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  b: 'bg-orange-600/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}

/** groupByTitlePrefix, or one flat pass-through cluster when toggled off. */
function titleClusters<T>(
  items: ReadonlyArray<T>,
  getTitle: (item: T) => string,
  grouped: boolean,
): ReturnType<typeof groupByTitlePrefix<T>> {
  if (grouped) return groupByTitlePrefix(items, getTitle)
  return [
    {
      prefix: null,
      items: items.map((item) => ({ item, shortTitle: getTitle(item) })),
    },
  ]
}

function pairMatchesSearch(pair: PairedLayer, query: string): boolean {
  if (!query) return true
  return (
    pair.title.toLowerCase().includes(query) ||
    (pair.subtitle?.toLowerCase().includes(query) ?? false) ||
    Object.values(pair.perSource).some((l) =>
      l.name.toLowerCase().includes(query),
    )
  )
}

export function GeoLayerBrowser({
  hasB = true,
  pairs,
  selection,
  sourceA,
  sourceB,
  onCollapse,
}: {
  /** Solo hides the slot filter and the A/B availability chips. */
  hasB?: boolean
  pairs: ReadonlyArray<PairedLayer>
  selection: CompareSelection
  sourceA: LensSource
  sourceB: LensSource
  onCollapse: () => void
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  const [search, setSearch] = useState('')
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('all')
  const [selectedLevels, setSelectedLevels] = useState<Set<number>>(new Set())
  const [grouped, setGrouped] = useState(true)
  const query = search.trim().toLowerCase()

  // Per-panel selection browses one catalog at a time: "All" would
  // interleave two unrelated catalogs and "A∩B" is empty by definition,
  // so unlinked mode offers just A | B.
  const unlinked = selection.linkMode !== 'linked'
  const effectiveFilter: SlotFilter =
    unlinked && (slotFilter === 'all' || slotFilter === 'both')
      ? 'a'
      : slotFilter

  const filteredPairs = useMemo(
    () => pairs.filter((pair) => pairMatchesSearch(pair, query)),
    [pairs, query],
  )
  const partitioned = useMemo(
    () => groupPairs(filteredPairs, effectiveFilter),
    [filteredPairs, effectiveFilter],
  )

  const toggleLevel = (level: number) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="space-y-2 border-b border-border bg-muted/40 px-3 pt-2.5 pb-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCollapse}
            title={tExec('lens.collapseSidebar')}
            aria-label={tExec('lens.collapseSidebar')}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {tExec('lens.layers')}
          </P>
          <button
            type="button"
            onClick={() => setGrouped((v) => !v)}
            aria-pressed={grouped}
            title={t('browser.groupToggle')}
            aria-label={t('browser.groupToggle')}
            className={cn(
              'ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground',
              grouped ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {grouped ? (
              <ListTree className="h-3.5 w-3.5" />
            ) : (
              <List className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('picker.searchPlaceholder')}
            className="h-8 pl-7 text-sm"
          />
        </div>
        {/* All | A | B availability filter (just A | B when unlinked). */}
        {hasB && (
          <div
            role="group"
            aria-label={t('browser.filterAria')}
            className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
          >
            {(unlinked
              ? (['a', 'b'] as const)
              : (['all', 'a', 'b', 'both'] as const)
            ).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSlotFilter(f)}
                aria-pressed={effectiveFilter === f}
                title={f === 'both' ? t('browser.bothHint') : undefined}
                className={cn(
                  'flex-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                  effectiveFilter === f
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f === 'all'
                  ? t('browser.all')
                  : f === 'both'
                    ? t('browser.both')
                    : f.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        {partitioned.allLevels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {partitioned.allLevels.map((level) => {
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
        {selection.autoUnlinked && (
          <P className="text-xs text-amber-700 dark:text-amber-300">
            {t('link.autoUnlinked')}
          </P>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
        {selection.linkMode === 'linked' ? (
          <LinkedSections
            partitioned={partitioned}
            selectedLevels={selectedLevels}
            selection={selection}
            showChips={hasB}
            query={query}
            grouped={grouped}
            loading={sourceA.loadingLayers || sourceB.loadingLayers}
          />
        ) : (
          <>
            <UnlinkedSourceSection
              slot="a"
              source={sourceA}
              selection={selection}
              query={query}
              slotFilter={effectiveFilter}
              selectedLevels={selectedLevels}
              grouped={grouped}
            />
            {hasB && (
              <UnlinkedSourceSection
                slot="b"
                source={sourceB}
                selection={selection}
                query={query}
                slotFilter={effectiveFilter}
                selectedLevels={selectedLevels}
                grouped={grouped}
              />
            )}
          </>
        )}
      </div>
    </aside>
  )
}

// ============================================================
// Linked mode — paired groups
// ============================================================

function LinkedSections({
  partitioned,
  selectedLevels,
  selection,
  showChips,
  query,
  grouped,
  loading,
}: {
  partitioned: ReturnType<typeof groupPairs>
  selectedLevels: ReadonlySet<number>
  selection: CompareSelection
  showChips: boolean
  query: string
  grouped: boolean
  loading: boolean
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  const multiLevel = useMemo(
    () =>
      partitioned.multiLevel
        .map((group) => ({
          ...group,
          entries:
            selectedLevels.size === 0
              ? group.entries
              : group.entries.filter(
                  (e) => e.level !== null && selectedLevels.has(e.level),
                ),
        }))
        .filter((group) => group.entries.length > 0),
    [partitioned.multiLevel, selectedLevels],
  )

  if (partitioned.singles.length === 0 && multiLevel.length === 0) {
    if (loading) {
      return (
        <P className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {tExec('lens.loadingLayers')}
        </P>
      )
    }
    return (
      <P className="p-2 text-sm text-muted-foreground">
        {t('picker.searchEmpty')}
      </P>
    )
  }
  return (
    <>
      {partitioned.singles.length > 0 && (
        <section>
          <SectionHeading>{t('browser.surface')}</SectionHeading>
          <ul className="space-y-1">
            {titleClusters(partitioned.singles, (g) => g.title, grouped).map(
              (cluster) =>
                cluster.prefix === null ? (
                  cluster.items.map(({ item: group }) => (
                    <li key={group.key}>
                      <PairRow
                        pair={group.entries[0]}
                        selection={selection}
                        showChips={showChips}
                      />
                    </li>
                  ))
                ) : (
                  <TitlePrefixGroup
                    key={`${cluster.prefix}:${query}`}
                    prefix={cluster.prefix}
                    count={cluster.items.length}
                    activeCount={
                      cluster.items.filter(({ item }) =>
                        selection.isPairActive(item.entries[0].key),
                      ).length
                    }
                    defaultOpen={query !== ''}
                  >
                    {cluster.items.map(({ item: group, shortTitle }) => (
                      <li key={group.key} className="px-1 py-0.5">
                        <PairRow
                          pair={group.entries[0]}
                          selection={selection}
                          title={shortTitle}
                          compact
                          showChips={showChips}
                        />
                      </li>
                    ))}
                  </TitlePrefixGroup>
                ),
            )}
          </ul>
        </section>
      )}
      {multiLevel.length > 0 && (
        <section>
          <SectionHeading>{t('browser.pressure')}</SectionHeading>
          <ul className="space-y-1.5">
            {multiLevel.map((group) => (
              <PairGroupRow
                key={group.key}
                group={group}
                selection={selection}
                showChips={showChips}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** Collapsible multi-level parameter group (embedded-viewer pattern). */
function PairGroupRow({
  group,
  selection,
  showChips,
}: {
  group: ReturnType<typeof groupPairs>['multiLevel'][number]
  selection: CompareSelection
  showChips: boolean
}) {
  const { t } = useTranslation('visualise')
  const [open, setOpen] = useState(false)
  const unit = group.levelUnit ?? 'hPa'
  const activeCount = group.entries.filter((e) =>
    selection.isPairActive(e.key),
  ).length

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
            <P className="truncate font-mono text-xs text-muted-foreground">
              {group.subtitle}
            </P>
          )}
        </div>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {activeCount > 0 && (
            <span className="rounded bg-primary/10 px-1 font-mono text-primary">
              {activeCount}
            </span>
          )}
          {t('browser.levels', { count: group.entries.length })}
        </span>
      </button>
      {open && (
        <ul className="border-t border-border px-1 py-1">
          {group.entries.map((pair) => (
            <li key={pair.key} className="px-1 py-0.5">
              <PairRow
                pair={pair}
                selection={selection}
                title={`${pair.level} ${unit}`}
                compact
                showChips={showChips}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** One selectable pair with A/B availability chips. */
function PairRow({
  pair,
  selection,
  title,
  compact = false,
  showChips = true,
}: {
  pair: PairedLayer
  selection: CompareSelection
  title?: string
  compact?: boolean
  showChips?: boolean
}) {
  const { t } = useTranslation('visualise')
  const active = selection.isPairActive(pair.key)
  const label = title ?? pair.title

  return (
    <button
      type="button"
      onClick={() => selection.togglePair(pair.key)}
      className={cn(
        'flex w-full items-center gap-2 rounded text-left transition-colors hover:bg-accent',
        compact ? 'px-1.5 py-1' : 'px-2 py-1.5',
        active && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-medium',
          compact ? 'font-mono text-xs' : 'text-sm',
        )}
        title={label}
      >
        {label}
      </span>
      {showChips && <SlotChips chipPair={pair} />}
      {active ? (
        <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  )

  function SlotChips({ chipPair }: { chipPair: PairedLayer }) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        {(['a', 'b'] as const).map((slot) => (
          <span
            key={slot}
            title={
              chipPair.perSource[slot]
                ? t('link.availableIn', { slots: slot.toUpperCase() })
                : t('link.notAvailableIn', { slot: slot.toUpperCase() })
            }
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded font-mono text-[10px] font-bold',
              chipPair.perSource[slot]
                ? SLOT_CHIP_CLASS[slot]
                : 'border border-dashed border-border text-muted-foreground/60',
            )}
          >
            {slot.toUpperCase()}
          </span>
        ))}
      </span>
    )
  }
}

// ============================================================
// Unlinked mode — per-source grouped sections
// ============================================================

function UnlinkedSourceSection({
  slot,
  source,
  selection,
  query,
  slotFilter,
  selectedLevels,
  grouped,
}: {
  slot: SourceSlot
  source: LensSource
  selection: CompareSelection
  query: string
  slotFilter: SlotFilter
  selectedLevels: ReadonlySet<number>
  grouped: boolean
}) {
  const { t } = useTranslation('visualise')
  const { t: tExec } = useTranslation('executions')
  // 'both' never reaches here (handled as an empty state upstream).
  if (slotFilter === 'a' || slotFilter === 'b') {
    if (slotFilter !== slot) return null
  }

  const groups = source.groups.filter(
    (g) =>
      !query ||
      g.title.toLowerCase().includes(query) ||
      (g.subtitle?.toLowerCase().includes(query) ?? false) ||
      g.entries.some((e) => e.layer.name.toLowerCase().includes(query)),
  )

  return (
    <section>
      <SectionHeading>
        <span
          className={cn(
            'mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded font-mono text-[10px] font-bold',
            SLOT_CHIP_CLASS[slot],
          )}
        >
          {slot.toUpperCase()}
        </span>
      </SectionHeading>
      <ul className="space-y-1">
        {(() => {
          const rows = groups.flatMap((group) => {
            const entries =
              selectedLevels.size === 0
                ? group.entries
                : group.entries.filter(
                    (e) => e.level === null || selectedLevels.has(e.level),
                  )
            return entries.map((entry) => ({
              name: entry.layer.name,
              label:
                entry.level !== null
                  ? `${group.title} · ${entry.level} ${group.levelUnit ?? 'hPa'}`
                  : group.title,
            }))
          })
          const row = (name: string, label: string) => {
            const active = selection.isLayerActive(slot, name)
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => selection.toggleLayer(slot, name)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent',
                    active && 'bg-primary/10',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate" title={label}>
                    {label}
                  </span>
                  {active ? (
                    <X className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            )
          }
          return titleClusters(rows, (r) => r.label, grouped).map((cluster) =>
            cluster.prefix === null ? (
              cluster.items.map(({ item }) => row(item.name, item.label))
            ) : (
              <TitlePrefixGroup
                key={`${cluster.prefix}:${query}`}
                prefix={cluster.prefix}
                count={cluster.items.length}
                activeCount={
                  cluster.items.filter(({ item }) =>
                    selection.isLayerActive(slot, item.name),
                  ).length
                }
                defaultOpen={query !== ''}
              >
                {cluster.items.map(({ item, shortTitle }) =>
                  row(item.name, shortTitle),
                )}
              </TitlePrefixGroup>
            ),
          )
        })()}
        {groups.length === 0 &&
          (source.loadingLayers ? (
            <P className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tExec('lens.loadingLayers')}
            </P>
          ) : (
            <P className="px-2 py-1 text-sm text-muted-foreground">
              {t('picker.searchEmpty')}
            </P>
          ))}
      </ul>
    </section>
  )
}

/** Collapsible cluster of layers sharing a leading title prefix. */
function TitlePrefixGroup({
  prefix,
  count,
  activeCount,
  defaultOpen,
  children,
}: {
  prefix: string
  count: number
  activeCount: number
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation('visualise')
  const [open, setOpen] = useState(defaultOpen)

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
        <P
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={prefix}
        >
          {prefix}
        </P>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {activeCount > 0 && (
            <span className="rounded bg-primary/10 px-1 font-mono text-primary">
              {activeCount}
            </span>
          )}
          {t('browser.layers', { count })}
        </span>
      </button>
      {open && <ul className="border-t border-border px-1 py-1">{children}</ul>}
    </li>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <P className="flex items-center px-1 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </P>
  )
}
