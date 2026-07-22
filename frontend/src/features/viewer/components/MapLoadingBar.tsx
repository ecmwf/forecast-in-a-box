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
 * Thin indeterminate bar along a map panel's top edge while that source
 * has GetMap requests in flight — the frame on screen is not current.
 * The 150 ms appearance delay keeps cache hits from flashing it.
 */

import type { SourceSlot } from '../geo/layer-pairing'
import { cn } from '@/lib/utils'

const SLOT_BAR_CLASS: Record<SourceSlot, string> = {
  a: 'bg-blue-600 dark:bg-blue-500',
  b: 'bg-orange-600 dark:bg-orange-500',
}

export function MapLoadingBar({
  loading,
  slot = null,
  className,
}: {
  loading: boolean
  /** Colors the bar in the source's slot color; null = neutral. */
  slot?: SourceSlot | null
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden transition-opacity duration-200',
        loading ? 'opacity-100 delay-150' : 'opacity-0',
        className,
      )}
    >
      <div
        className={cn(
          'h-full w-1/4',
          slot ? SLOT_BAR_CLASS[slot] : 'bg-primary',
          loading && 'animate-[map-loading-sweep_1.1s_linear_infinite]',
        )}
      />
    </div>
  )
}
