/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The shared journal header: title + flow toggle, status tabs, group-by, search. */

import { useTranslation } from 'react-i18next'
import type { RunFilter } from '@/features/journal/types'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import { FacetSearchBar } from '@/features/journal/facets/FacetSearchBar'
import { GroupBySelect } from '@/features/journal/grouping/GroupBySelect'
import { useUiStore } from '@/stores/uiStore'
import { H2 } from '@/components/base/typography'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

interface ForecastRunSearchHeaderProps {
  /** Omit when the page header already names the list. */
  title?: string
  /** Per-filter counts shown beside the labels. */
  counts?: Partial<Record<RunFilter, number>>
  query: string
  onQueryChange: (query: string) => void
  activeFilter: RunFilter
  onFilterChange: (filter: RunFilter) => void
  filters: ReadonlyArray<RunFilter>
  /** Omit `groupBy`/`onGroupByChange` to hide the group-by control. */
  groupBy?: GroupBy
  onGroupByChange?: (groupBy: GroupBy) => void
}

export function ForecastRunSearchHeader({
  title,
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  filters,
  counts,
  groupBy,
  onGroupByChange,
}: ForecastRunSearchHeaderProps) {
  const { t } = useTranslation('journal')
  const showFlow = useUiStore((state) => state.journalShowFlow)
  const setShowFlow = useUiStore((state) => state.setJournalShowFlow)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border p-4 sm:p-6',
        title ? 'justify-between' : 'justify-end',
      )}
    >
      {title && <H2 className="shrink-0 text-xl font-semibold">{title}</H2>}

      {/* Controls — flow toggle, search, status filters, group-by. Filters wrap rather than hide. */}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:justify-end">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>{t('flowToggle')}</span>
          <Switch
            checked={showFlow}
            onCheckedChange={setShowFlow}
            aria-label={t('flowToggle')}
          />
        </div>
        <FacetSearchBar value={query} onChange={onQueryChange} />

        <ToggleGroup
          value={[activeFilter]}
          onValueChange={(values) => {
            // Base UI single-select is still string[]; ignore empty (re-click).
            const next = values[0]
            if (next) onFilterChange(next as RunFilter)
          }}
          variant="outline"
          size="sm"
          aria-label={t('filters.label')}
        >
          {filters.map((filter) => {
            const count = counts?.[filter]
            return (
              <ToggleGroupItem
                key={filter}
                value={filter}
                variant="outline"
                size="sm"
                className="gap-1.5 whitespace-nowrap"
              >
                {t(`filters.${filter}`)}
                {count !== undefined && (
                  <span
                    aria-hidden
                    className="font-mono text-xs text-muted-foreground tabular-nums"
                  >
                    {count}
                  </span>
                )}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>

        {groupBy !== undefined && onGroupByChange && (
          <div className="hidden lg:flex">
            <GroupBySelect value={groupBy} onChange={onGroupByChange} />
          </div>
        )}
      </div>
    </div>
  )
}
