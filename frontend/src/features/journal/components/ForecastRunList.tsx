/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The shared Forecast Journal card: header slot, run rows (flat or grouped), footer slot. */

import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { ForecastRunViewModel } from '@/features/journal/types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import type { FacetToken } from '@/features/journal/facets/facet-types'
import { groupRuns } from '@/features/journal/grouping/group-runs'
import { ForecastRunRow } from '@/features/journal/components/ForecastRunRow'
import { JournalGroup } from '@/features/journal/components/JournalGroup'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Card } from '@/components/ui/card'

interface ForecastRunListProps {
  runs: Array<ForecastRunViewModel>
  isLoading?: boolean
  emptyText?: string
  groupBy?: GroupBy
  onToggleBookmark: (runId: string) => void
  onAddFacet?: (token: FacetToken) => void
  header?: ReactNode
  footer?: ReactNode
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function ForecastRunList({
  runs,
  isLoading,
  emptyText,
  groupBy = 'none',
  onToggleBookmark,
  onAddFacet,
  header,
  footer,
  variant,
  shadow,
}: ForecastRunListProps) {
  const { t } = useTranslation('journal')

  function rows(items: Array<ForecastRunViewModel>): ReactNode {
    return items.map((run) => (
      <ForecastRunRow
        key={run.runId}
        run={run}
        onToggleBookmark={onToggleBookmark}
        onAddFacet={onAddFacet}
      />
    ))
  }

  let body: ReactNode
  if (isLoading) {
    body = (
      <div className="flex justify-center p-12">
        <LoadingSpinner />
      </div>
    )
  } else if (runs.length === 0) {
    body = (
      <div className="p-12 text-center text-muted-foreground">
        {emptyText ?? t('empty')}
      </div>
    )
  } else if (groupBy === 'none') {
    body = <div className="divide-y divide-border">{rows(runs)}</div>
  } else {
    body = groupRuns(runs, groupBy).map((group) => {
      let label: string
      if (groupBy === 'date') {
        label =
          group.id === 'today'
            ? t('dateGroup.today')
            : group.id === 'yesterday'
              ? t('dateGroup.yesterday')
              : group.id === 'week'
                ? t('dateGroup.week')
                : t('dateGroup.older')
      } else if (group.id === '__untagged__') {
        label = t('group.untagged')
      } else if (group.id === '__unscheduled__') {
        label = t('group.unscheduled')
      } else {
        label = group.id
      }
      return (
        <JournalGroup key={group.id} label={label} count={group.runs.length}>
          {rows(group.runs)}
        </JournalGroup>
      )
    })
  }

  return (
    <Card className="overflow-hidden" variant={variant} shadow={shadow}>
      {header}
      {body}
      {footer}
    </Card>
  )
}
