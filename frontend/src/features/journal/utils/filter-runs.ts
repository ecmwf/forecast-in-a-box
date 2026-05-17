/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { ForecastRunViewModel, RunFilter } from '@/features/journal/types'
import type {
  FacetKey,
  ParsedQuery,
} from '@/features/journal/facets/facet-types'
import { applyFacetQuery } from '@/features/journal/facets/apply-facet-query'

/** Case-insensitive substring test of a run against one facet token value. */
function matchesFacet(
  run: ForecastRunViewModel,
  key: FacetKey,
  value: string,
): boolean {
  const needle = value.toLowerCase()
  if (key === 'model') {
    return (run.modelLabel ?? '').toLowerCase().includes(needle)
  }
  if (key === 'output') {
    return run.outputKinds.some((kind) => kind.toLowerCase().includes(needle))
  }
  return run.tags.some((tag) => tag.toLowerCase().includes(needle))
}

/** Apply the status/bookmark tab filter plus a faceted query to a run list. */
export function filterRuns(
  runs: ReadonlyArray<ForecastRunViewModel>,
  filter: RunFilter,
  query: ParsedQuery,
): Array<ForecastRunViewModel> {
  const byTab = runs.filter((run) => {
    if (filter === 'all') return true
    if (filter === 'bookmarked') return run.isBookmarked
    return run.status === filter
  })

  return applyFacetQuery(byTab, query, {
    supportedKeys: ['model', 'output', 'tag'],
    matchFacet: matchesFacet,
    matchText: (run, text) =>
      run.displayName.toLowerCase().includes(text) ||
      (run.displayDescription?.toLowerCase().includes(text) ?? false) ||
      run.runId.toLowerCase().includes(text) ||
      (run.modelLabel?.toLowerCase().includes(text) ?? false) ||
      run.tags.some((tag) => tag.toLowerCase().includes(text)),
  })
}
