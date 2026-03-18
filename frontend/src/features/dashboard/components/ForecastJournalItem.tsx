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
 * ForecastJournalItem Component
 *
 * Individual item in the forecast journal list
 */

import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MoreVertical,
  Star,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ForecastJob } from '@/features/dashboard/data/mockData'
import { H3 } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface ForecastJournalItemProps {
  job: ForecastJob
}

function StatusIcon({ status }: { status: ForecastJob['status'] }) {
  switch (status) {
    case 'running':
      return <Clock className="h-5 w-5 text-blue-500" />
    case 'completed':
      return (
        <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-emerald-500" />
      )
    case 'error':
      return <AlertCircle className="h-5 w-5 fill-red-500 text-red-500" />
  }
}

export function ForecastJournalItem({ job }: ForecastJournalItemProps) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Status Icon */}
        <div className="mt-1 shrink-0 sm:mt-0">
          <StatusIcon status={job.status} />
        </div>

        {/* Job Details */}
        <div className="grow">
          <div className="mb-1 flex items-center gap-2">
            <H3 className="text-sm font-medium">{job.name}</H3>
          </div>
          <div className="mb-2 text-sm text-muted-foreground">
            {t('journal.item.model', { model: job.model })} ·{' '}
            {t('journal.item.started', { time: job.startedAt })} ·{' '}
            {t('journal.item.products', { count: job.productCount })}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Job ID */}
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
              #{job.id}
            </span>
            {/* Scheduled Badge */}
            {job.isScheduled && (
              <span className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-sm text-blue-600 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
                <Clock className="h-3 w-3" />
                {t('journal.item.scheduled')}
              </span>
            )}
            {/* Tags */}
            {job.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border bg-card px-2 py-0.5 text-sm text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
          {/* Progress or Action Link */}
          {job.status === 'running' && job.progress !== undefined ? (
            <div className="flex w-32 items-center gap-3">
              <span className="w-8 text-sm font-bold">{job.progress}%</span>
              <div className="h-2 grow overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          ) : job.status === 'completed' ? (
            <Link
              to="/executions/$jobId"
              params={{ jobId: job.id }}
              className="text-sm font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {t('journal.item.viewResults')}
            </Link>
          ) : job.status === 'error' ? (
            <Link
              to="/executions/$jobId"
              params={{ jobId: job.id }}
              className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400"
            >
              {t('journal.item.viewError')}
            </Link>
          ) : null}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              className={cn(
                'transition-colors hover:text-yellow-500',
                job.isBookmarked && 'text-yellow-500',
              )}
              aria-label="Bookmark"
            >
              <Star
                className={cn('h-5 w-5', job.isBookmarked && 'fill-yellow-500')}
              />
            </button>
            <button
              className="transition-colors hover:text-primary"
              aria-label="More options"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
