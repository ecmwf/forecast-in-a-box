/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** group-runs Unit Tests — date/status/tag grouping of the journal list. */

import { describe, expect, it } from 'vitest'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { groupRuns } from '@/features/journal/grouping/group-runs'

function run(overrides: Partial<ForecastRunViewModel>): ForecastRunViewModel {
  return {
    runId: 'r',
    attemptCount: 1,
    displayName: 'Run',
    displayDescription: null,
    status: 'completed',
    progress: 100,
    createdAt: '2026-05-16T10:00:00',
    modelLabel: 'AIFS',
    outputCount: 1,
    outputKinds: [],
    tags: [],
    blueprintId: 'bp',
    fromPreset: false,
    scheduleName: null,
    isBookmarked: false,
    ...overrides,
  }
}

describe('groupRuns', () => {
  it('none → a single group of all runs', () => {
    const runs = [run({ runId: 'a' }), run({ runId: 'b' })]
    expect(groupRuns(runs, 'none')).toEqual([{ id: 'all', runs }])
  })

  it('none → empty when there are no runs', () => {
    expect(groupRuns([], 'none')).toEqual([])
  })

  it('tag → multi-membership with an untagged bucket', () => {
    const groups = groupRuns(
      [
        run({ runId: 'a', tags: ['eu', 'prod'] }),
        run({ runId: 'b', tags: ['eu'] }),
        run({ runId: 'c', tags: [] }),
      ],
      'tag',
    )
    const sizeById = Object.fromEntries(
      groups.map((g) => [g.id, g.runs.length]),
    )
    expect(sizeById.eu).toBe(2)
    expect(sizeById.prod).toBe(1)
    expect(sizeById.__untagged__).toBe(1)
  })

  it('schedule → groups by schedule, unscheduled bucket last', () => {
    const groups = groupRuns(
      [
        run({ runId: 'a', scheduleName: 'Nightly' }),
        run({ runId: 'b', scheduleName: null }),
        run({ runId: 'c', scheduleName: 'Daily' }),
        run({ runId: 'd', scheduleName: 'Nightly' }),
      ],
      'schedule',
    )
    expect(groups.map((g) => g.id)).toEqual([
      'Daily',
      'Nightly',
      '__unscheduled__',
    ])
    expect(groups.find((g) => g.id === 'Nightly')?.runs).toHaveLength(2)
  })

  it('date → buckets runs by age, in fixed order', () => {
    const now = new Date('2026-05-16T12:00:00')
    const groups = groupRuns(
      [
        run({ runId: 'old', createdAt: '2026-05-01T10:00:00' }),
        run({ runId: 'today', createdAt: '2026-05-16T08:00:00' }),
        run({ runId: 'yest', createdAt: '2026-05-15T08:00:00' }),
      ],
      'date',
      now,
    )
    expect(groups.map((g) => g.id)).toEqual(['today', 'yesterday', 'older'])
  })
})
