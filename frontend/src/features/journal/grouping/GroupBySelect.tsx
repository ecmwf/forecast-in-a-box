/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import type { GroupBy } from '@/features/journal/grouping/group-runs'
import { GROUP_BY_OPTIONS } from '@/features/journal/grouping/group-runs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** "Group by" dropdown for the forecast journal. */
export function GroupBySelect({
  value,
  onChange,
}: {
  value: GroupBy
  onChange: (groupBy: GroupBy) => void
}) {
  const { t } = useTranslation('journal')
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {t('groupBy.label')}
      </span>
      <Select value={value} onValueChange={(next) => onChange(next as GroupBy)}>
        <SelectTrigger className="h-8 w-28 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GROUP_BY_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {t(groupByLabelKey(option))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Map a GroupBy value to its statically-known i18n key. */
function groupByLabelKey(
  option: GroupBy,
): 'groupBy.none' | 'groupBy.date' | 'groupBy.schedule' | 'groupBy.tag' {
  if (option === 'date') return 'groupBy.date'
  if (option === 'schedule') return 'groupBy.schedule'
  if (option === 'tag') return 'groupBy.tag'
  return 'groupBy.none'
}
