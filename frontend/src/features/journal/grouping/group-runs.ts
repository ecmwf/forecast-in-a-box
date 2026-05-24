/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Group the journal run list by date, schedule, or tag. */

import { differenceInCalendarDays } from 'date-fns'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { groupByKey } from '@/lib/group-by'

export type GroupBy = 'none' | 'date' | 'schedule' | 'tag'

export const GROUP_BY_OPTIONS: ReadonlyArray<GroupBy> = [
  'none',
  'date',
  'schedule',
  'tag',
]

/** Group id for runs with no user tags / not from a schedule. */
export const UNTAGGED_GROUP = '__untagged__'
export const UNSCHEDULED_GROUP = '__unscheduled__'

/** A group of runs; `id` keys the group and resolves its display label. */
export interface RunGroup {
  id: string
  runs: Array<ForecastRunViewModel>
}

/** Stable display order for date buckets. */
const DATE_BUCKETS = ['today', 'yesterday', 'week', 'older'] as const

function dateBucket(
  createdAt: string,
  now: Date,
  parse: (naive: string) => Date,
): string {
  const days = differenceInCalendarDays(now, parse(createdAt))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return 'week'
  return 'older'
}

/** Split runs into ordered, non-empty groups for the given grouping.
 * Pass `useServerTime().serverTimeToLocal` for `parseCreatedAt` to avoid
 * TZ-offset skew; the `new Date` default is fine for tests. */
export function groupRuns(
  runs: ReadonlyArray<ForecastRunViewModel>,
  groupBy: GroupBy,
  now: Date = new Date(),
  parseCreatedAt: (naive: string) => Date = (s) => new Date(s),
): Array<RunGroup> {
  if (groupBy === 'none') {
    return runs.length > 0 ? [{ id: 'all', runs: [...runs] }] : []
  }

  if (groupBy === 'tag') {
    // Multi-membership: a run appears under each of its tags (Gmail-style).
    const byTag = new Map<string, Array<ForecastRunViewModel>>()
    for (const run of runs) {
      const keys = run.tags.length > 0 ? run.tags : [UNTAGGED_GROUP]
      for (const key of keys) {
        const bucket = byTag.get(key)
        if (bucket) bucket.push(run)
        else byTag.set(key, [run])
      }
    }
    return [...byTag.entries()].map(([id, grouped]) => ({ id, runs: grouped }))
  }

  if (groupBy === 'schedule') {
    const bySchedule = groupByKey(
      runs,
      (run) => run.scheduleName ?? UNSCHEDULED_GROUP,
    )
    return bySchedule
      .map(([id, grouped]) => ({ id, runs: grouped }))
      .sort((a, b) => {
        // Unscheduled runs last; named schedules alphabetically.
        if (a.id === UNSCHEDULED_GROUP) return 1
        if (b.id === UNSCHEDULED_GROUP) return -1
        return a.id.localeCompare(b.id)
      })
  }

  // date
  const byBucket = groupByKey(runs, (run) =>
    dateBucket(run.createdAt, now, parseCreatedAt),
  )
  return DATE_BUCKETS.map((bucket) => ({
    id: bucket,
    runs: byBucket.find(([id]) => id === bucket)?.[1] ?? [],
  })).filter((group) => group.runs.length > 0)
}
