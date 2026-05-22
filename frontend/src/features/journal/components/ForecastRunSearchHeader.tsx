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
import { cn } from '@/lib/utils'

interface ForecastRunSearchHeaderProps {
  title: string
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
  groupBy,
  onGroupByChange,
}: ForecastRunSearchHeaderProps) {
  const { t } = useTranslation('journal')
  const showFlow = useUiStore((state) => state.journalShowFlow)
  const setShowFlow = useUiStore((state) => state.setJournalShowFlow)

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border p-4 sm:p-6">
      {/* Title + flow-preview toggle */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <H2 className="text-xl font-semibold">{title}</H2>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>{t('flowToggle')}</span>
          <Switch
            checked={showFlow}
            onCheckedChange={setShowFlow}
            aria-label={t('flowToggle')}
          />
        </div>
      </div>

      {/* Controls — search, status filters, group-by. Filters wrap rather than hide. */}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:justify-end">
        <FacetSearchBar value={query} onChange={onQueryChange} />

        <div
          role="group"
          aria-label={t('filters.label')}
          className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-medium text-muted-foreground"
        >
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={activeFilter === filter}
              onClick={() => onFilterChange(filter)}
              className={cn(
                'rounded-md px-3 py-1.5 whitespace-nowrap transition-colors',
                activeFilter === filter
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted',
              )}
            >
              {t(`filters.${filter}`)}
            </button>
          ))}
        </div>

        {groupBy !== undefined && onGroupByChange && (
          <div className="hidden lg:flex">
            <GroupBySelect value={groupBy} onChange={onGroupByChange} />
          </div>
        )}
      </div>
    </div>
  )
}
