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
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScheduleListItem } from './ScheduleListItem'
import type { ScheduleDefinitionResponse } from '@/api/types/schedule.types'
import type { ParsedQuery } from '@/features/journal/facets/facet-types'
import { useSchedules } from '@/api/hooks/useSchedules'
import { FacetSearchBar } from '@/features/journal/facets/FacetSearchBar'
import { addToken, parseQuery } from '@/features/journal/facets/parse-query'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/common/PageHeader'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

type EnabledFilter = 'all' | 'enabled' | 'disabled'

const ENABLED_FILTERS: Array<EnabledFilter> = ['all', 'enabled', 'disabled']

/**
 * Apply a faceted search query to the schedule list. Schedules only carry
 * `tag` facets; any other token is folded into the free-text match.
 */
function filterSchedules(
  schedules: ReadonlyArray<ScheduleDefinitionResponse>,
  query: ParsedQuery,
): Array<ScheduleDefinitionResponse> {
  let result = [...schedules]

  // tag tokens: OR within the key.
  const tagValues = query.tokens
    .filter((token) => token.key === 'tag')
    .map((token) => token.value.toLowerCase())
  if (tagValues.length > 0) {
    result = result.filter((schedule) =>
      tagValues.some((value) =>
        (schedule.tags ?? []).some((tag) => tag.toLowerCase().includes(value)),
      ),
    )
  }

  const text = [
    query.text,
    ...query.tokens
      .filter((token) => token.key !== 'tag')
      .map((token) => token.value),
  ]
    .join(' ')
    .trim()
    .toLowerCase()
  if (text) {
    result = result.filter(
      (schedule) =>
        (schedule.display_name ?? '').toLowerCase().includes(text) ||
        (schedule.display_description ?? '').toLowerCase().includes(text) ||
        schedule.experiment_id.toLowerCase().includes(text) ||
        (schedule.tags ?? []).some((tag) => tag.toLowerCase().includes(text)),
    )
  }

  return result
}

export function ScheduleListPage() {
  const { t } = useTranslation('schedules')
  const layoutMode = useUiStore((state) => state.layoutMode)
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

  const containerClass = cn(
    'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
    layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
  )

  if (isLoading) {
    return (
      <div className={containerClass}>
        <PageHeader
          title={t('page.title')}
          description={t('page.description')}
        />
        <div className="flex justify-center py-12">
          <LoadingSpinner text={t('list.loading')} />
        </div>
      </div>
    )
  }

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

  const schedules = data?.experiments ?? []
  const sorted = [...schedules].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )
  const filteredSchedules = filterSchedules(sorted, parseQuery(query))
  const totalPages = data?.total_pages ?? 1

  return (
    <div className={containerClass}>
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
            <div className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground">
              <Clock className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <P className="font-medium">{t('empty.title')}</P>
                <P className="text-sm">{t('empty.description')}</P>
              </div>
            </div>
          )}
        </div>

        {totalPages > 1 && (
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
        )}
      </Card>
    </div>
  )
}
