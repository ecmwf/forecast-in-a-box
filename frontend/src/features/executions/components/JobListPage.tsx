/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The /executions page — the full, paginated Forecast Journal. */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRouteApi } from '@tanstack/react-router'
import type { RunFilter } from '@/features/journal/types'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useForecastRuns } from '@/features/journal/data/useForecastRuns'
import { filterRuns } from '@/features/journal/utils/filter-runs'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { ForecastRunList } from '@/features/journal/components/ForecastRunList'
import { ForecastRunSearchHeader } from '@/features/journal/components/ForecastRunSearchHeader'
import { PageHeader } from '@/components/common/PageHeader'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

const EXECUTIONS_FILTERS: ReadonlyArray<RunFilter> = [
  'all',
  'submitted',
  'running',
  'completed',
  'failed',
  'bookmarked',
]

const route = getRouteApi('/_authenticated/executions/')

export function JobListPage() {
  const { t } = useTranslation('executions')
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const [page, setPage] = useState(1)
  const search = route.useSearch()
  const navigate = route.useNavigate()

  // Journal state lives in the URL — shareable and reload-safe.
  const query = search.q ?? ''
  const activeFilter: RunFilter = search.status ?? 'all'
  const groupBy: GroupBy = search.group ?? 'date'

  const setQuery = (value: string) => {
    void navigate({ search: (prev) => ({ ...prev, q: value || undefined }) })
  }
  const setActiveFilter = (status: RunFilter) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        status: status === 'all' ? undefined : status,
      }),
    })
  }
  const setGroupBy = (group: GroupBy) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        group: group === 'date' ? undefined : group,
      }),
    })
  }

  const { data, isLoading, isError, error } = useJobsStatus(page, PAGE_SIZE)
  const { runs, toggleBookmark } = useForecastRuns(data?.runs ?? [])
  const totalPages = data?.total_pages ?? 1

  const filtered = useMemo(
    () => filterRuns(runs, activeFilter, parseQuery(query)),
    [runs, activeFilter, query],
  )

  const containerClass = cn(
    'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
    layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
  )

  if (isError) {
    return (
      <div className={containerClass}>
        <PageHeader
          title={t('page.title')}
          description={t('page.description')}
        />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <P className="text-destructive">{error.message}</P>
        </div>
      </div>
    )
  }

  return (
    <div className={containerClass}>
      <PageHeader title={t('page.title')} description={t('page.description')} />

      <ForecastRunList
        runs={filtered}
        isLoading={isLoading}
        emptyText={t('empty.description')}
        groupBy={groupBy}
        onToggleBookmark={toggleBookmark}
        onAddFacet={(token) => setQuery(addToken(query, token))}
        variant={dashboardVariant}
        shadow={panelShadow}
        header={
          <ForecastRunSearchHeader
            title={t('page.title')}
            query={query}
            onQueryChange={setQuery}
            activeFilter={activeFilter}
            onFilterChange={(filter) => {
              setActiveFilter(filter)
              setPage(1)
            }}
            filters={EXECUTIONS_FILTERS}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />
        }
        footer={
          totalPages > 1 ? (
            <div className="border-t border-border p-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t('pagination.previous')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('pagination.page', { current: page, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('pagination.next')}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
}
