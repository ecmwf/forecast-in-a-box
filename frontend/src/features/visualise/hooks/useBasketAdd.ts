/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { entryDisplayName } from '../entry-ref'
import type { AddEntryOutcome } from '../stores/comparisonStore'
import { showToast } from '@/lib/toast'

const slotRef = (value: unknown) =>
  typeof value === 'string' ? value : undefined

/** Refs shown in slots A and B (URL state); the basket never drops them. */
export function useSlotRefs(): ReadonlyArray<string | undefined> {
  const a = useRouterState({
    select: (s) => slotRef((s.location.search as Record<string, unknown>).a),
  })
  const b = useRouterState({
    select: (s) => slotRef((s.location.search as Record<string, unknown>).b),
  })
  return [a, b]
}

/** Toast for a manual add, naming what was dropped to make room. */
export function useAddedToast() {
  const { t } = useTranslation('visualise')
  return (name: string, outcome: AddEntryOutcome) => {
    if (outcome.status !== 'added') return
    if (outcome.evicted.length === 0) {
      showToast.success(t('toast.added', { name }))
      return
    }
    showToast.success(
      t('toast.addedMadeRoom', {
        name,
        evicted: outcome.evicted.map(entryDisplayName).join(', '),
      }),
    )
  }
}
