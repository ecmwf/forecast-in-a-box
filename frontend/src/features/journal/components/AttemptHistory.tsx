/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Expandable list of a run's restart attempts, newest first. */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useRunAttempts } from '@/features/journal/data/useRunAttempts'
import { cn } from '@/lib/utils'

export function AttemptHistory({
  runId,
  attemptCount,
}: {
  runId: string
  attemptCount: number
}) {
  const { t } = useTranslation('journal')
  const [open, setOpen] = useState(false)
  const attempts = useRunAttempts(runId, attemptCount, open)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')}
        />
        {t('attempts.label', { count: attemptCount })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          {[...attempts]
            .sort((a, b) => b.attempt_count - a.attempt_count)
            .map((attempt) => (
              <li
                key={attempt.attempt_count}
                className="flex items-center gap-2"
              >
                <span className="font-medium text-foreground">
                  {t('attempts.attempt', { number: attempt.attempt_count })}
                </span>
                <span>·</span>
                <span>{t(`status.${attempt.status}`)}</span>
              </li>
            ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
