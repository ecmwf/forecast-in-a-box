/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useMemo, useState } from 'react'
import type { ForecastRunViewModel } from '@/features/journal/types'

/** Capped multi-select for the compare-in-Visualise flow; keeps the runs
 * themselves so a pick survives paging and filtering. */
export function useRunSelection(cap: number) {
  const [selected, setSelected] = useState<
    ReadonlyMap<string, ForecastRunViewModel>
  >(() => new Map())
  const toggle = useCallback(
    (run: ForecastRunViewModel) => {
      setSelected((prev) => {
        const next = new Map(prev)
        if (next.has(run.runId)) next.delete(run.runId)
        else if (next.size < cap) next.set(run.runId, run)
        return next
      })
    },
    [cap],
  )
  const clear = useCallback(() => setSelected(new Map()), [])
  const selectedIds = useMemo(
    () => new Set(selected.keys()) as ReadonlySet<string>,
    [selected],
  )
  const selectedRuns = useMemo(() => [...selected.values()], [selected])
  return { selectedIds, selectedRuns, toggle, clear, cap }
}
