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
 * The one "Add to comparison" affordance, reused on stored-output rows,
 * active-lens rows, and the /compare source picker. Toggles: an entry
 * already in the basket shows a check and removes on click.
 */

import { Check, GitCompareArrows } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDisplayName, entryRef } from '../entry-ref'
import {
  MAX_COMPARISON_ENTRIES,
  useComparisonStore,
  useIsInComparison,
} from '../stores/comparisonStore'
import type { NewComparisonEntry } from '../entry-ref'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'

export function AddToComparisonButton({
  entry,
  disabled = false,
  iconOnly = false,
  disabledReason,
}: {
  entry: NewComparisonEntry
  disabled?: boolean
  /** Compact icon-only variant for dense rows (label stays as aria/title). */
  iconOnly?: boolean
  /** Tooltip explaining a disabled button (e.g. unmatched lens path). */
  disabledReason?: string
}) {
  const { t } = useTranslation('compare')
  const ref = entryRef(entry)
  const inBasket = useIsInComparison(ref)
  const addEntry = useComparisonStore((s) => s.addEntry)
  const removeEntry = useComparisonStore((s) => s.removeEntry)

  const name = entryDisplayName(entry)
  const label = inBasket ? t('entry.inBasket') : t('entry.add')
  const aria = inBasket ? t('entry.removeAria') : t('entry.addAria')

  const onClick = () => {
    if (inBasket) {
      removeEntry(ref)
      showToast.info(t('toast.removed', { name }))
      return
    }
    const result = addEntry(entry)
    if (result === 'added') {
      showToast.success(t('toast.added', { name }))
    } else if (result === 'full') {
      showToast.error(t('toast.full', { max: MAX_COMPARISON_ENTRIES }))
    }
  }

  return (
    <Button
      variant={inBasket ? 'secondary' : 'outline'}
      size={iconOnly ? 'icon' : 'sm'}
      className={iconOnly ? 'h-8 w-8 shrink-0' : 'h-8 shrink-0 gap-1.5'}
      disabled={disabled}
      aria-pressed={inBasket}
      aria-label={aria}
      title={disabled && disabledReason ? disabledReason : aria}
      onClick={onClick}
    >
      {inBasket ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <GitCompareArrows className="h-3.5 w-3.5" />
      )}
      {!iconOnly && label}
    </Button>
  )
}
