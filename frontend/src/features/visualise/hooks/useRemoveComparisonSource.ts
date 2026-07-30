/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Remove a basket entry everywhere it is referenced: the store, its
 * now-orphaned lens, and — when on /visualise — the URL slot pair. A dead
 * active ref left in the URL wedges slot repair (hydration has already
 * processed it) and resurrects the source with its lens on reload.
 */

import { useCallback } from 'react'
import { useMatch, useNavigate } from '@tanstack/react-router'
import { SLOT_B_OFF, entryRef } from '../entry-ref'
import { useComparisonStore } from '../stores/comparisonStore'
import { useStopOrphanedLenses } from './useStopOrphanedLenses'
import type { ComparisonEntry, NewComparisonEntry } from '../entry-ref'

export function useRemoveComparisonSource(): (
  entry: ComparisonEntry | NewComparisonEntry,
) => void {
  const removeEntry = useComparisonStore((s) => s.removeEntry)
  const stopOrphanedLenses = useStopOrphanedLenses()
  // Slot params only exist while the route is mounted; removal elsewhere
  // (e.g. an executions-page toggle) has no URL state to repair.
  const onVisualise = useMatch({
    from: '/_authenticated/visualise',
    shouldThrow: false,
  })
  const navigate = useNavigate()

  return useCallback(
    (entry) => {
      const ref = entryRef(entry)
      removeEntry(ref)
      void stopOrphanedLenses([entry], useComparisonStore.getState().entries)
      if (!onVisualise) return
      void navigate({
        to: '/visualise',
        search: (prev: { a?: string; b?: string }) => {
          const a = prev.a === ref ? undefined : prev.a
          const b = prev.b === ref ? undefined : prev.b
          // Removing A promotes a surviving B — the viewer pivots on A.
          return a === undefined && b !== undefined && b !== SLOT_B_OFF
            ? { ...prev, a: b, b: undefined }
            : { ...prev, a, b }
        },
        replace: true,
      })
    },
    [removeEntry, stopOrphanedLenses, onVisualise, navigate],
  )
}
