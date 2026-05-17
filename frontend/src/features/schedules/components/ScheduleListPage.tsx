/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The schedules list — enabled/disabled tabs, faceted search and pagination. */

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScheduleListItem } from './ScheduleListItem'
import type { ScheduleDefinitionResponse } from '@/api/types/schedule.types'
import type { ParsedQuery } from '@/features/journal/facets/facet-types'
import { useSchedules } from '@/api/hooks/useSchedules'
import { FacetSearchBar } from '@/features/journal/facets/FacetSearchBar'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { applyFacetQuery } from '@/features/journal/facets/apply-facet-query'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { H2 } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

type EnabledFilter = 'all' | 'enabled' | 'disabled'

const ENABLED_FILTERS: Array<EnabledFilter> = ['all', 'enabled', 'disabled']

/**
 * Apply a faceted search query to the schedule list. Schedules only understand
 * `tag` facets; other tokens fold into the free-text match.
 */
function filterSchedules(
  schedules: ReadonlyArray<ScheduleDefinitionResponse>,
  query: ParsedQuery,
): Array<ScheduleDefinitionResponse> {
  return applyFacetQuery(schedules, query, {
    supportedKeys: ['tag'],
    matchFacet: (schedule, _key, value) =>
      (schedule.tags ?? []).some((tag) =>
        tag.toLowerCase().includes(value.toLowerCase()),
      ),
    matchText: (schedule, text) =>
      (schedule.display_name ?? '').toLowerCase().includes(text) ||
      (schedule.display_description ?? '').toLowerCase().includes(text) ||
      schedule.experiment_id.toLowerCase().includes(text) ||
      (schedule.tags ?? []).some((tag) => tag.toLowerCase().includes(text)),
  })
}

export function ScheduleListPage() {
  const { t } = useTranslation('schedules')
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const [page, setPage] = useState(1)
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all')
  const [query, setQuery] = useState('')

  const queryEnabled =
    enabledFilter === 'all' ? undefined : enabledFilter === 'enabled'

  const { data, isLoading, isError, error } = useSchedules(
    page,
    PAGE_SIZE,
    queryEnabled,
  )

  if (isLoading) {
    return (
      <ListPageContainer>
        <PageHeader
          title={t('page.title')}
          description={t('page.description')}
        />
        <div className="flex justify-center py-12">
          <LoadingSpinner text={t('list.loading')} />
        </div>
      </ListPageContainer>
    )
  }

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

  const schedules = data?.experiments ?? []
  const sorted = [...schedules].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )
  const filteredSchedules = filterSchedules(sorted, parseQuery(query))
  const totalPages = data?.total_pages ?? 1

  return (
    <ListPageContainer>
      <PageHeader title={t('page.title')} description={t('page.description')} />

      <Card
        className="overflow-hidden"
        variant={dashboardVariant}
        shadow={panelShadow}
      >
        <div className="flex flex-col items-start justify-between gap-4 border-b border-border p-6 sm:flex-row sm:items-center">
          <H2 className="text-xl font-semibold">{t('page.title')}</H2>

          {/* Faceted search — shared with the Forecast Journal — plus tabs. */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:justify-end">
            <FacetSearchBar value={query} onChange={setQuery} />

            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              {ENABLED_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    setEnabledFilter(filter)
                    setPage(1)
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 transition-colors',
                    enabledFilter === filter
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  {t(`filter.${filter}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="divide-y divide-border">
          {filteredSchedules.length > 0 ? (
            filteredSchedules.map((schedule) => (
              <ScheduleListItem
                key={schedule.experiment_id}
                scheduleId={schedule.experiment_id}
                schedule={schedule}
                onAddFacet={(token) =>
                  setQuery((current) => addToken(current, token))
                }
              />
            ))
          ) : (
            <EmptyState
              icon={Clock}
              title={t('empty.title')}
              description={t('empty.description')}
            />
          )}
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </Card>
    </ListPageContainer>
  )
}
