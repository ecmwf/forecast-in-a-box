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

import { useCallback, useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, getRouteApi } from '@tanstack/react-router'
import type { ForecastRunViewModel, RunFilter } from '@/features/journal/types'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import { useRunSelection } from '@/features/journal/hooks/useRunSelection'
import { CompareSelectionBar } from '@/features/journal/components/CompareSelectionBar'
import { Button } from '@/components/ui/button'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { useServerTime } from '@/api/hooks/useSchedules'
import { useForecastRuns } from '@/features/journal/data/useForecastRuns'
import { filterRuns } from '@/features/journal/utils/filter-runs'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { ForecastRunList } from '@/features/journal/components/ForecastRunList'
import { ForecastRunSearchHeader } from '@/features/journal/components/ForecastRunSearchHeader'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { formatInZone } from '@/lib/datetime'

const PAGE_SIZE = 10

const EXECUTIONS_FILTERS: ReadonlyArray<RunFilter> = [
  'all',
  'submitted',
  'running',
  'completed',
  'failed',
  'bookmarked',
]

const route = getRouteApi('/_authenticated/execute/')

export function RunListPage() {
  const { t } = useTranslation('executions')
  const [page, setPage] = useState(1)
  const selection = useRunSelection(2)
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

  // App-TZ date — keeps the facet aligned with the row in any client TZ.
  const { serverTimeToLocal, timeZone } = useServerTime()
  const displayDateFor = useCallback(
    (run: ForecastRunViewModel) =>
      formatInZone(serverTimeToLocal(run.createdAt), timeZone, 'yyyy-MM-dd'),
    [serverTimeToLocal, timeZone],
  )

  const noRunsYet = !isLoading && runs.length === 0
  const { counts: statusCounts, total: totalRuns } = useJobStatusCounts()
  const filterCounts = useMemo(
    () => ({
      all: totalRuns,
      submitted: statusCounts.submitted + statusCounts.preparing,
      running: statusCounts.running,
      completed: statusCounts.completed,
      failed: statusCounts.failed,
    }),
    [statusCounts, totalRuns],
  )
  const filtered = useMemo(
    () => filterRuns(runs, activeFilter, parseQuery(query), displayDateFor),
    [runs, activeFilter, query, displayDateFor],
  )

  if (isError) {
    return (
      <ListPageContainer>
        <PageHeader
          title={t('page.title')}
          description={t('page.description')}
        />
        <ErrorPanel message={error.message} />
      </ListPageContainer>
    )
  }

  return (
    <ListPageContainer>
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
        actions={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/schedules" />}
          >
            <CalendarClock />
            {t('page.scheduledRuns')}
          </Button>
        }
      />

      <ForecastRunList
        runs={filtered}
        isLoading={isLoading}
        emptyText={noRunsYet ? t('empty.description') : t('empty.filtered')}
        emptyAction={
          noRunsYet ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/configure" />}
            >
              {t('empty.action')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('')
                setActiveFilter('all')
              }}
            >
              {t('empty.clearFilters')}
            </Button>
          )
        }
        groupBy={groupBy}
        onToggleBookmark={toggleBookmark}
        onAddFacet={(token) => setQuery(addToken(query, token))}
        selectedIds={selection.selectedIds}
        selectionCap={selection.cap}
        onToggleSelect={selection.toggle}
        header={
          <>
            <ForecastRunSearchHeader
              counts={filterCounts}
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
            <CompareSelectionBar
              runs={runs}
              selectedIds={selection.selectedIds}
              onClear={selection.clear}
            />
          </>
        }
        footer={
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        }
      />
    </ListPageContainer>
  )
}
