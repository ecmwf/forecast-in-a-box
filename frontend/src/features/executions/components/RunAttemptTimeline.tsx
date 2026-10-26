/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A run's attempts as one stacked line; the full history in a popover. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { JobExecutionDetail, JobStatus } from '@/api/types/job.types'
import { isTerminalStatus } from '@/api/types/job.types'
import { useServerTime } from '@/api/hooks/useSchedules'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useRunAttempts } from '@/features/journal/data/useRunAttempts'
import { formatInZone } from '@/lib/datetime'
import { cn } from '@/lib/utils'

/** Dots in the collapsed stack; older attempts collapse into "+N". */
const STACK_SIZE = 5

const DOT_CLASS: Record<JobStatus, string> = {
  submitted: 'bg-blue-500',
  preparing: 'bg-blue-500',
  running: 'bg-amber-500',
  stopping: 'bg-slate-400',
  stopped: 'bg-slate-400',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  unknown: 'bg-gray-400',
}

interface RunAttemptTimelineProps {
  jobId: string
  attemptCount: number
}

export function RunAttemptTimeline({
  jobId,
  attemptCount,
}: RunAttemptTimelineProps) {
  const { t } = useTranslation(['executions', 'common'])
  const { serverTimeToLocal, timeZone } = useServerTime()
  const [open, setOpen] = useState(false)
  const multiple = attemptCount > 1
  const recent = useRunAttempts(jobId, attemptCount, multiple, STACK_SIZE)
  const all = useRunAttempts(jobId, attemptCount, multiple && open)
  if (!multiple || recent.length === 0) return null

  const byNumber = (a: JobExecutionDetail, b: JobExecutionDetail) =>
    a.attempt_count - b.attempt_count
  const stack = [...recent].sort(byNumber)
  const hidden = attemptCount - stack.length
  // Exact only once every attempt is known.
  const known = all.length === attemptCount ? all : stack
  const failed =
    known.length === attemptCount
      ? known.filter((a) => a.status === 'failed').length
      : null
  const history = [...(all.length > 0 ? all : stack)].sort((a, b) =>
    byNumber(b, a),
  )
  const time = (iso: string) =>
    formatInZone(serverTimeToLocal(iso), timeZone, 'yyyy-MM-dd HH:mm')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="group -mx-1.5 inline-flex w-fit items-center gap-2.5 rounded-md px-1.5 py-0.5 text-sm transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        }
      >
        <span className="flex items-center" aria-hidden>
          {hidden > 0 && (
            <span className="mr-1.5 font-mono text-xs text-muted-foreground tabular-nums">
              +{hidden}
            </span>
          )}
          {stack.map((attempt, index) => (
            <span
              key={attempt.attempt_count}
              className={cn(
                'size-3.5 rounded-full ring-2 ring-background transition-[margin] duration-150 motion-reduce:transition-none',
                index > 0 && '-ml-1.5 group-hover:-ml-0.5',
                DOT_CLASS[attempt.status],
              )}
            />
          ))}
        </span>
        <span className="font-medium">
          {t('attempts.count', { count: attemptCount })}
        </span>
        {failed !== null && failed > 0 && (
          <span className="text-muted-foreground">
            {t('attempts.failedCount', { count: failed })}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 gap-1 p-2">
        <div className="px-2 pt-1 text-sm font-medium">
          {t('attempts.title')}
        </div>
        <ol className="max-h-72 overflow-y-auto">
          {history.map((attempt) => (
            <li
              key={attempt.attempt_count}
              className="flex gap-2.5 rounded-md px-2 py-1.5"
            >
              <span
                className={cn(
                  'mt-1.5 size-2.5 shrink-0 rounded-full',
                  DOT_CLASS[attempt.status],
                )}
              />
              <span className="min-w-0">
                <span className="block">
                  <span className="font-medium">
                    {t('attempts.attempt', { number: attempt.attempt_count })}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {t(`status.${attempt.status}`)}
                  </span>
                </span>
                <span className="block text-muted-foreground tabular-nums">
                  {time(attempt.created_at)} · {duration(attempt, t)}
                </span>
              </span>
            </li>
          ))}
          {all.length < attemptCount && (
            <li className="px-2 py-1.5 text-muted-foreground">
              {t('common:loading')}
            </li>
          )}
        </ol>
      </PopoverContent>
    </Popover>
  )
}

/** Run time in its two largest units, e.g. "2 m 24 s". */
function duration(attempt: JobExecutionDetail, t: TFunction<'executions'>) {
  const end = isTerminalStatus(attempt.status)
    ? new Date(attempt.updated_at)
    : new Date()
  const secs = Math.max(
    0,
    Math.round((end.getTime() - new Date(attempt.created_at).getTime()) / 1000),
  )
  const [d, h, m, s] = [
    Math.floor(secs / 86400),
    Math.floor(secs / 3600) % 24,
    Math.floor(secs / 60) % 60,
    secs % 60,
  ]
  if (d) return t('attempts.duration.days', { a: d, b: h })
  if (h) return t('attempts.duration.hours', { a: h, b: m })
  if (m) return t('attempts.duration.minutes', { a: m, b: s })
  return t('attempts.duration.seconds', { a: s })
}
