/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useState } from 'react'

/** Capped multi-select of run ids for the compare-in-Visualise flow. */
export function useRunSelection(cap: number) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const toggle = useCallback(
    (runId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(runId)) next.delete(runId)
        else if (next.size < cap) next.add(runId)
        return next
      })
    },
    [cap],
  )
  const clear = useCallback(() => setSelectedIds(new Set()), [])
  return { selectedIds, toggle, clear, cap }
}
