/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Dashboard widget: the most recent runs. The full list lives at /executions. */

import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import type { ForecastRunViewModel, RunFilter } from '@/features/journal/types'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import type { FacetToken } from '@/features/journal/facets/facet-types'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useServerTime } from '@/api/hooks/useSchedules'
import { useForecastRuns } from '@/features/journal/data/useForecastRuns'
import { filterRuns } from '@/features/journal/utils/filter-runs'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { ForecastRunList } from '@/features/journal/components/ForecastRunList'
import { ForecastRunSearchHeader } from '@/features/journal/components/ForecastRunSearchHeader'
import { formatInZone } from '@/lib/datetime'

interface ForecastJournalProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

/** Recent runs shown before "View all". */
const DASHBOARD_RUN_COUNT = 6

const DASHBOARD_FILTERS: ReadonlyArray<RunFilter> = [
  'all',
  'running',
  'completed',
  'failed',
  'bookmarked',
]

export function ForecastJournal({ variant, shadow }: ForecastJournalProps) {
  const { t } = useTranslation('journal')
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<RunFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('date')

  const { data, isLoading } = useJobsStatus(1, DASHBOARD_RUN_COUNT)
  const { runs, toggleBookmark } = useForecastRuns(data?.runs ?? [])

  // App-TZ date — keeps the facet aligned with the row in any client TZ.
  const { serverTimeToLocal, timeZone } = useServerTime()
  const displayDateFor = useCallback(
    (run: ForecastRunViewModel) =>
      formatInZone(serverTimeToLocal(run.createdAt), timeZone, 'yyyy-MM-dd'),
    [serverTimeToLocal, timeZone],
  )

  // Defer filtering so typing in the search box stays responsive on long lists.
  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(
    () =>
      filterRuns(runs, activeFilter, parseQuery(deferredQuery), displayDateFor),
    [runs, activeFilter, deferredQuery, displayDateFor],
  )

  const handleAddFacet = useCallback(
    (token: FacetToken) => setQuery((prev) => addToken(prev, token)),
    [],
  )

  return (
    <ForecastRunList
      runs={filtered}
      isLoading={isLoading}
      groupBy={groupBy}
      onToggleBookmark={toggleBookmark}
      onAddFacet={handleAddFacet}
      variant={variant}
      shadow={shadow}
      header={
        <ForecastRunSearchHeader
          title={t('title')}
          query={query}
          onQueryChange={setQuery}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          filters={DASHBOARD_FILTERS}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />
      }
      footer={
        <div className="border-t border-border p-4 text-center">
          <Link
            to="/runs"
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            {t('viewAll')}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Link>
        </div>
      }
    />
  )
}
