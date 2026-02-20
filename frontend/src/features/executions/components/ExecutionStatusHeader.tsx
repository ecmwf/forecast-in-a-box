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
 * ExecutionStatusHeader Component
 *
 * Status header with name, badge, progress bar, and action buttons.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreVertical, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { JobStatus } from '@/api/types/job.types'
import { isTerminalStatus } from '@/api/types/job.types'
import {
  getStatusBadgeClasses,
  getStatusBarColor,
} from '@/features/executions/utils/job-status'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { H2, P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface ExecutionStatusHeaderProps {
  jobId: string
  name: string
  description?: string
  status: JobStatus
  progress: string
  createdAt: string | null
  error: string | null
  onRestart: () => void
  onDelete: () => void
  onEdit?: () => void
  isRestartPending: boolean
  isDeletePending: boolean
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m ${seconds}s`
}

function useElapsedTime(createdAt: string | null, isTerminal: boolean) {
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    if (!createdAt) {
      setElapsed(null)
      return
    }

    const startTime = new Date(createdAt).getTime()

    const update = () => setElapsed(Date.now() - startTime)
    update()

    if (isTerminal) return

    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [createdAt, isTerminal])

  return elapsed
}

export function ExecutionStatusHeader({
  jobId,
  name,
  description,
  status,
  progress,
  createdAt,
  onRestart,
  onDelete,
  onEdit,
  isRestartPending,
  isDeletePending,
}: ExecutionStatusHeaderProps) {
  const { t } = useTranslation('executions')
  const terminal = isTerminalStatus(status)
  const elapsed = useElapsedTime(createdAt, terminal)

  const progressPercent = parseFloat(progress) || 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <H2 className="text-2xl font-bold">{name}</H2>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          {description && (
            <P className="line-clamp-2 text-muted-foreground">{description}</P>
          )}
          <P className="truncate text-muted-foreground">{jobId}</P>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-sm font-medium',
              getStatusBadgeClasses(status),
            )}
          >
            {t(`status.${status}`)}
          </span>

          {elapsed !== null && (
            <span className="text-sm text-muted-foreground">
              {formatElapsed(elapsed)}
            </span>
          )}

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="outline" size="sm" disabled={isRestartPending}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {t('actions.restart')}
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('actions.restartJob')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('actions.confirmRestart')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('submit.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onRestart}>
                  {t('actions.restart')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" />}
              >
                <MoreVertical className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <AlertDialogTrigger
                  render={
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={isDeletePending}
                    />
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.delete')}
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('actions.deleteJob')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('actions.confirmDelete')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('submit.cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDelete}>
                  {t('actions.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            getStatusBarColor(status),
          )}
          style={{ width: `${Math.min(progressPercent, 100)}%` }}
        />
      </div>
    </div>
  )
}
