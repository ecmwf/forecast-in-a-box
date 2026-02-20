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
 * JobListPage Component
 *
 * Main executions list page with status filtering and pagination.
 */

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { JobListItem } from './JobListItem'
import type { JobStatus } from '@/api/types/job.types'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { LoadingSpinner, PageHeader } from '@/components/common'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useJobMetadataStore } from '@/features/executions/stores/useJobMetadataStore'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

type StatusFilter = 'all' | 'submitted' | 'running' | 'completed' | 'errored'

const STATUS_FILTERS: Array<StatusFilter> = [
  'all',
  'submitted',
  'running',
  'completed',
  'errored',
]

export function JobListPage() {
  const { t } = useTranslation('executions')
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const queryStatus =
    statusFilter === 'all' ? undefined : (statusFilter as JobStatus)
  const { data, isLoading, isError, error } = useJobsStatus(
    page,
    PAGE_SIZE,
    queryStatus,
  )

  const jobs = useJobMetadataStore((s) => s.jobs)

  if (isLoading) {
    return (
      <div
        className={cn(
          'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
          layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
        )}
      >
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
      <div
        className={cn(
          'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
          layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
        )}
      >
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

  const progresses = data?.progresses ?? {}
  let jobIds = Object.keys(progresses).sort((a, b) => {
    const aTime = progresses[a].created_at ?? ''
    const bTime = progresses[b].created_at ?? ''
    return bTime.localeCompare(aTime)
  })
  const totalPages = data?.total_pages ?? 1

  // Client-side search filter on name, jobId, and tags
  if (searchQuery) {
    const query = searchQuery.toLowerCase()
    jobIds = jobIds.filter((jobId) => {
      const meta = jobs[jobId] as (typeof jobs)[string] | undefined
      return (
        jobId.toLowerCase().includes(query) ||
        meta?.name.toLowerCase().includes(query) ||
        meta?.tags.some((tag) => tag.toLowerCase().includes(query))
      )
    })
  }

  return (
    <div
      className={cn(
        'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      <PageHeader title={t('page.title')} description={t('page.description')} />

      <Card
        className="overflow-hidden"
        variant={dashboardVariant}
        shadow={panelShadow}
      >
        <div className="flex flex-col items-start justify-between gap-4 border-b border-border p-6 sm:flex-row sm:items-center">
          <H2 className="text-xl font-semibold">{t('page.title')}</H2>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                <Search className="h-4 w-4" />
              </span>
              <Input
                type="text"
                placeholder={t('filter.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 sm:w-64"
              />
            </div>

            <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    setStatusFilter(filter)
                    setPage(1)
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 transition-colors',
                    statusFilter === filter
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
          {jobIds.length > 0 ? (
            jobIds.map((jobId) => (
              <JobListItem
                key={jobId}
                jobId={jobId}
                status={progresses[jobId]}
                metadata={jobs[jobId]}
              />
            ))
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              {t('empty.description')}
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
