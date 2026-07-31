/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** filterRuns Unit Tests — status tabs + faceted search filtering. */

import { describe, expect, it } from 'vitest'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { filterRuns } from '@/features/journal/utils/filter-runs'
import { parseQuery } from '@/features/journal/facets/parse-query'

function run(overrides: Partial<ForecastRunViewModel>): ForecastRunViewModel {
  return {
    runId: 'run-1',
    attemptCount: 1,
    displayName: 'Europe Forecast',
    displayDescription: null,
    status: 'completed',
    progress: 100,
    createdAt: '2026-05-16T10:00:00',
    modelLabel: 'AIFS Single',
    outputCount: 2,
    lostOutputCount: 0,
    outputKinds: ['image'],
    tags: ['europe'],
    blueprintId: 'bp-1',
    fromPreset: false,
    scheduleName: null,
    isBookmarked: false,
    ...overrides,
  }
}

const runs: Array<ForecastRunViewModel> = [
  run({
    runId: 'r-done',
    status: 'completed',
    displayName: 'Done Run',
    displayDescription: 'weekend backfill',
    modelLabel: 'AIFS Single',
    outputKinds: ['image'],
    tags: ['europe'],
  }),
  run({
    runId: 'r-active',
    status: 'running',
    displayName: 'Active Run',
    modelLabel: 'AIFS Ensemble',
    outputKinds: ['pdf'],
    tags: ['asia'],
  }),
  run({
    runId: 'r-fail',
    status: 'failed',
    displayName: 'Failed Run',
    modelLabel: 'IFS',
    outputKinds: ['netcdf'],
    tags: ['europe', 'prod'],
  }),
  run({
    runId: 'r-mark',
    status: 'completed',
    displayName: 'Marked Run',
    modelLabel: 'IFS',
    outputKinds: ['image'],
    tags: [],
    isBookmarked: true,
  }),
]

const ids = (result: Array<ForecastRunViewModel>) => result.map((r) => r.runId)

describe('filterRuns', () => {
  it('returns every run for the "all" filter and an empty query', () => {
    expect(filterRuns(runs, 'all', parseQuery(''))).toHaveLength(4)
  })

  it('filters by run status', () => {
    expect(ids(filterRuns(runs, 'running', parseQuery('')))).toEqual([
      'r-active',
    ])
  })

  it('filters to bookmarked runs', () => {
    expect(ids(filterRuns(runs, 'bookmarked', parseQuery('')))).toEqual([
      'r-mark',
    ])
  })

  it('filters by a model: facet token', () => {
    expect(ids(filterRuns(runs, 'all', parseQuery('model:aifs')))).toEqual([
      'r-done',
      'r-active',
    ])
  })

  it('filters by an output: facet token', () => {
    expect(ids(filterRuns(runs, 'all', parseQuery('output:image')))).toEqual([
      'r-done',
      'r-mark',
    ])
  })

  it('filters by a tag: facet token', () => {
    expect(ids(filterRuns(runs, 'all', parseQuery('tag:europe')))).toEqual([
      'r-done',
      'r-fail',
    ])
  })

  it('ANDs across different facet keys', () => {
    expect(
      ids(filterRuns(runs, 'all', parseQuery('model:ifs tag:prod'))),
    ).toEqual(['r-fail'])
  })

  it('ORs multiple tokens of the same facet key', () => {
    expect(
      ids(filterRuns(runs, 'all', parseQuery('tag:asia tag:prod'))),
    ).toEqual(['r-active', 'r-fail'])
  })

  it('matches free text against name, description, id, model and tags', () => {
    expect(ids(filterRuns(runs, 'all', parseQuery('marked')))).toEqual([
      'r-mark',
    ])
    expect(ids(filterRuns(runs, 'all', parseQuery('weekend')))).toEqual([
      'r-done',
    ])
  })

  it('combines the tab filter, facet tokens and free text', () => {
    expect(
      ids(filterRuns(runs, 'completed', parseQuery('tag:europe'))),
    ).toEqual(['r-done'])
  })
})
