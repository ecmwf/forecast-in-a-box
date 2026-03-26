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
 * JobListItem Component
 *
 * A single job row in the executions list, styled consistently with PresetRow.
 */

import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { JobExecutionDetail } from '@/api/types/job.types'
import { JobStatusIcon } from '@/features/executions/components/JobStatusIcon'
import { useBlockCatalogue, useFableRetrieve } from '@/api/hooks/useFable'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  getBlocksByKind,
} from '@/api/types/fable.types'
import { getStatusBarColor } from '@/features/executions/utils/job-status'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface JobListItemProps {
  jobId: string
  status: JobExecutionDetail
  fableId: string
}

export function JobListItem({ jobId, status, fableId }: JobListItemProps) {
  const { t } = useTranslation('executions')
  const { data: fableData } = useFableRetrieve(fableId)
  const { data: catalogue } = useBlockCatalogue()
  const progress = parseFloat(status.progress ?? '0') || 0
  const isRunning = status.status === 'running'

  const createdAt = status.created_at
    ? formatDistanceToNow(new Date(status.created_at), { addSuffix: true })
    : null

  const truncatedId = jobId.length > 12 ? `${jobId.slice(0, 12)}...` : jobId
  const displayName = fableData?.display_name || t('detail.untitledJob')
  const tags = fableData?.tags ?? []

  return (
    <div className="p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Content */}
        <div className="grow">
          <div className="mb-1 flex items-center gap-2">
            <JobStatusIcon status={status.status} />
            <Link
              to="/executions/$jobId"
              params={{ jobId }}
              className="truncate font-medium hover:underline"
            >
              {displayName}
            </Link>
          </div>
          {fableData?.display_description && (
            <P className="mb-2 line-clamp-1 text-sm text-muted-foreground">
              {fableData.display_description}
            </P>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
              #{truncatedId}
            </span>
            {fableData?.builder && catalogue && (
              <div className="flex flex-wrap gap-1.5">
                {BLOCK_KIND_ORDER.filter(
                  (kind) =>
                    getBlocksByKind(fableData.builder, catalogue, kind).length >
                    0,
                ).map((kind) => {
                  const meta = BLOCK_KIND_METADATA[kind]
                  const count = getBlocksByKind(
                    fableData.builder,
                    catalogue,
                    kind,
                  ).length
                  return (
                    <span
                      key={kind}
                      className="rounded bg-muted px-2 py-1 text-sm text-muted-foreground"
                    >
                      {count} {meta.label.toLowerCase()}
                      {count !== 1 ? 's' : ''}
                    </span>
                  )
                })}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <P className="text-sm text-muted-foreground">
              {t(`status.${status.status}`)}
              {createdAt && <> · {createdAt}</>}
            </P>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
          {isRunning ? (
            <div className="flex w-32 items-center gap-3">
              <span className="w-8 text-sm font-bold">
                {Math.round(progress)}%
              </span>
              <div className="h-2 grow overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full bg-foreground transition-all',
                    getStatusBarColor(status.status),
                  )}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>
          ) : status.status === 'completed' ? (
            <Link
              to="/executions/$jobId"
              params={{ jobId }}
              className="text-sm font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {t('outputs.view')}
            </Link>
          ) : status.status === 'failed' ? (
            <Link
              to="/executions/$jobId"
              params={{ jobId }}
              className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400"
            >
              {t('errors.executionFailed')}
            </Link>
          ) : (
            <Link
              to="/executions/$jobId"
              params={{ jobId }}
              className="text-sm font-semibold text-muted-foreground hover:underline"
            >
              {t('outputs.inspect')}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
