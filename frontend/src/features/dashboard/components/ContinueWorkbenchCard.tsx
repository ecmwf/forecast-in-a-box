/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { History } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { WorkbenchSummary } from '@/features/fable-builder/hooks/useWorkbenchSummary'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'

/** Full-width resume strip — session state, never competing for a grid slot. */
export function ContinueWorkbenchCard({
  summary,
}: {
  summary: WorkbenchSummary
}) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  const ago =
    summary.savedAt === null
      ? null
      : Math.round((Date.now() - summary.savedAt) / 60_000)
  const timeLabel =
    ago === null
      ? null
      : ago < 1
        ? t('gettingStarted.continue.justNow')
        : t('gettingStarted.continue.minutesAgo', { count: ago })

  const meta = [
    summary.fableName || t('gettingStarted.continue.untitled'),
    t('gettingStarted.continue.blockCount', { count: summary.blockCount }),
    ...(timeLabel ? [t('gettingStarted.continue.edited', { timeLabel })] : []),
  ].join(' · ')

  const resume = () => navigate({ to: '/configure' })

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('gettingStarted.continue.title')}
      data-testid="continue-workbench-card"
      onClick={resume}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault() // Space scrolls the page by default
          resume()
        }
      }}
      className="mb-6 flex cursor-pointer flex-col gap-4 rounded-lg border-2 border-primary/20 bg-muted/50 p-4 transition-colors hover:border-primary sm:flex-row sm:items-center"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <History className="h-5 w-5" />
      </div>

      <div className="min-w-0">
        <p className="font-bold">{t('gettingStarted.continue.title')}</p>
        <P className="truncate text-muted-foreground">{meta}</P>
      </div>

      <FableMiniFlow
        builder={summary.fable}
        monochrome={false}
        className="max-h-16 sm:mx-auto"
      />

      <Button size="sm" className="shrink-0 self-end sm:self-auto">
        {t('gettingStarted.continue.open')}
      </Button>
    </div>
  )
}
