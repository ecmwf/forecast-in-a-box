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
 * ForecastJournal Component
 *
 * Main journal view showing forecast job history
 */

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ForecastJournalFilters } from './ForecastJournalFilters'
import { ForecastJournalItem } from './ForecastJournalItem'
import type { FilterType } from './ForecastJournalFilters'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { mockForecastJobs } from '@/features/dashboard/data/mockData'
import { H2 } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface ForecastJournalProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function ForecastJournal({ variant, shadow }: ForecastJournalProps) {
  const { t } = useTranslation('dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')

  const filteredJobs = useMemo(() => {
    let jobs = [...mockForecastJobs]

    // Apply filter
    if (activeFilter !== 'all') {
      if (activeFilter === 'bookmarked') {
        jobs = jobs.filter((job) => job.isBookmarked)
      } else {
        jobs = jobs.filter((job) => job.status === activeFilter)
      }
    }

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      jobs = jobs.filter(
        (job) =>
          job.name.toLowerCase().includes(query) ||
          job.model.toLowerCase().includes(query) ||
          job.id.toLowerCase().includes(query) ||
          job.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
    }

    return jobs
  }, [searchQuery, activeFilter])

  return (
    <Card className="overflow-hidden" variant={variant} shadow={shadow}>
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-border p-6 sm:flex-row sm:items-center">
        <H2 className="text-xl font-semibold">{t('journal.title')}</H2>

        <div className="flex w-full items-center gap-3 sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:flex-initial">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
              <Search className="h-4 w-4" />
            </span>
            <Input
              type="text"
              placeholder={t('journal.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 sm:w-64"
            />
          </div>

          {/* Filters */}
          <ForecastJournalFilters
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />
        </div>
      </div>

      {/* Job List */}
      <div className="divide-y divide-border">
        {filteredJobs.length > 0 ? (
          filteredJobs.map((job) => (
            <ForecastJournalItem key={job.id} job={job} />
          ))
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            {t('journal.noResults')}
          </div>
        )}
      </div>

      {/* Footer */}
      {filteredJobs.length > 0 && (
        <div className="border-t border-border p-4 text-center">
          <button className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            {t('journal.loadMore')}
          </button>
        </div>
      )}
    </Card>
  )
}
