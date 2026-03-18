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
 * A single job row in the executions list.
 */

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Hourglass,
  Loader2,
  MoreVertical,
  Pencil,
  Timer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { JobProgressResponse, JobStatus } from '@/api/types/job.types'
import type { JobMetadata } from '@/features/executions/stores/useJobMetadataStore'
import { EditJobMetadataDialog } from '@/features/executions/components/EditJobMetadataDialog'
import { getStatusBarColor } from '@/features/executions/utils/job-status'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface JobListItemProps {
  jobId: string
  status: JobProgressResponse
  metadata: JobMetadata | undefined
}

function StatusIcon({ status }: { status: JobStatus }) {
  switch (status) {
    case 'submitted':
      return <Hourglass className="h-5 w-5 text-blue-500" />
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
    case 'completed':
      return (
        <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-emerald-500" />
      )
    case 'errored':
    case 'invalid':
      return <AlertCircle className="h-5 w-5 fill-red-500 text-red-500" />
    case 'timeout':
      return <Timer className="h-5 w-5 text-orange-500" />
    default:
      return <HelpCircle className="h-5 w-5 text-gray-500" />
  }
}

export function JobListItem({ jobId, status, metadata }: JobListItemProps) {
  const { t } = useTranslation('executions')
  const [editOpen, setEditOpen] = useState(false)
  const progress = parseFloat(status.progress) || 0
  const isRunning = status.status === 'running'

  const createdAt = status.created_at
    ? formatDistanceToNow(new Date(status.created_at), { addSuffix: true })
    : null

  const truncatedId = jobId.length > 12 ? `${jobId.slice(0, 12)}...` : jobId

  return (
    <div className="p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="mt-1 shrink-0 sm:mt-0">
          <StatusIcon status={status.status} />
        </div>

        <div className="grow">
          <div className="mb-1 flex items-center gap-2">
            <Link
              to="/executions/$jobId"
              params={{ jobId }}
              className="text-sm font-medium hover:underline"
            >
              {metadata?.name || t('detail.untitledJob')}
            </Link>
          </div>
          {metadata?.description && (
            <P className="mb-1 line-clamp-1 text-muted-foreground">
              {metadata.description}
            </P>
          )}
          <div className="mb-2 text-sm text-muted-foreground">
            {t(`status.${status.status}`)}
            {createdAt && <> · {createdAt}</>}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
              #{truncatedId}
            </span>
            {metadata?.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border bg-card px-2 py-0.5 text-sm text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

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
          ) : status.status === 'errored' || status.status === 'invalid' ? (
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

          {metadata && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="h-8 w-8" />
                }
              >
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t('actions.edit')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {metadata && (
        <EditJobMetadataDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          jobId={jobId}
          metadata={metadata}
        />
      )}
    </div>
  )
}
