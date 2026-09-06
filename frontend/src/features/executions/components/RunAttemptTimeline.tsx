/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One row per attempt, oldest first — the retry story at a glance. */

import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RunStatusIcon } from './RunStatusIcon'
import { useServerTime } from '@/api/hooks/useSchedules'
import { useRunAttempts } from '@/features/journal/data/useRunAttempts'
import { formatInZone } from '@/lib/datetime'

interface RunAttemptTimelineProps {
  jobId: string
  attemptCount: number
}

export function RunAttemptTimeline({
  jobId,
  attemptCount,
}: RunAttemptTimelineProps) {
  const { t } = useTranslation('executions')
  const { serverTimeToLocal, timeZone } = useServerTime()
  const attempts = useRunAttempts(jobId, attemptCount, attemptCount > 1)
  if (attemptCount < 2 || attempts.length === 0) return null

  const ordered = [...attempts].sort(
    (a, b) => a.attempt_count - b.attempt_count,
  )
  return (
    <ol
      aria-label={t('attempts.title')}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      {ordered.map((attempt, index) => (
        <li key={attempt.attempt_count} className="flex items-center gap-2">
          {index > 0 && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
          )}
          <RunStatusIcon status={attempt.status} />
          <span className="font-medium">
            {t('attempts.attempt', { number: attempt.attempt_count })}
          </span>
          <span className="text-muted-foreground">
            {t(`status.${attempt.status}`)} ·{' '}
            {formatInZone(
              serverTimeToLocal(attempt.updated_at),
              timeZone,
              'yyyy-MM-dd HH:mm',
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
