/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useForecastRuns } from '@/features/journal/data/useForecastRuns'
import { ForecastRunList } from '@/features/journal/components/ForecastRunList'
import { H2 } from '@/components/base/typography'
import { Button } from '@/components/ui/button'

/** Overview shows the latest runs and hands off to Execute for the rest. */
const RECENT_RUN_COUNT = 5

export function ForecastJournal() {
  const { t } = useTranslation('journal')
  const { data, isLoading } = useJobsStatus(1, RECENT_RUN_COUNT)
  const { runs, toggleBookmark } = useForecastRuns(data?.runs ?? [])

  return (
    <ForecastRunList
      runs={runs}
      isLoading={isLoading}
      onToggleBookmark={toggleBookmark}
      emptyText={t('noRunsYet')}
      emptyAction={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/configure" />}
        >
          {t('configureForecast')}
        </Button>
      }
      header={
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <H2 className="text-xl font-semibold">{t('title')}</H2>
          <Link
            to="/execute"
            className="hit-target-y inline-flex shrink-0 items-center text-sm font-medium text-primary hover:underline"
          >
            {t('viewAll')}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Link>
        </div>
      }
    />
  )
}
