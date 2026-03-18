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
 * ForecastJournalFilters Component
 *
 * Filter tabs for the forecast journal
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type FilterType =
  | 'all'
  | 'running'
  | 'completed'
  | 'error'
  | 'bookmarked'

interface ForecastJournalFiltersProps {
  activeFilter: FilterType
  onFilterChange: (filter: FilterType) => void
}

export function ForecastJournalFilters({
  activeFilter,
  onFilterChange,
}: ForecastJournalFiltersProps) {
  const { t } = useTranslation('dashboard')

  const filters: Array<{ key: FilterType; label: string }> = [
    { key: 'all', label: t('journal.filters.all') },
    { key: 'running', label: t('journal.filters.running') },
    { key: 'completed', label: t('journal.filters.completed') },
    { key: 'error', label: t('journal.filters.error') },
    { key: 'bookmarked', label: t('journal.filters.bookmarked') },
  ]

  return (
    <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
      {filters.map((filter) => (
        <button
          key={filter.key}
          onClick={() => onFilterChange(filter.key)}
          className={cn(
            'rounded-md px-3 py-1.5 transition-colors',
            activeFilter === filter.key
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-muted',
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
