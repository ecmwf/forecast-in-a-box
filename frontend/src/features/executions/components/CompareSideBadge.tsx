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
import type { SourceSlot } from '@/features/viewer/geo/layer-pairing'
import { cn } from '@/lib/utils'

export const SLOT_FILL_CLASS: Record<SourceSlot, string> = {
  a: 'bg-slot-a',
  b: 'bg-slot-b',
}

/** Square A or B in the side's colour, as on the map's slot bar. */
export function CompareSideBadge({
  side,
  className,
}: {
  side: SourceSlot
  className?: string
}) {
  const { t } = useTranslation('executions')
  return (
    <span
      aria-label={t('storedOutputs.compare.side', { slot: side.toUpperCase() })}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold text-white',
        SLOT_FILL_CLASS[side],
        className,
      )}
    >
      {side.toUpperCase()}
    </span>
  )
}
