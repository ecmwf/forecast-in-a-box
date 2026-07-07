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
 * Slot identity tag floated over a compare map. The A/B hues match the
 * basket chips and availability tracks so a source is recognizable in
 * every surface.
 */

import type { SourceSlot } from './layer-pairing'
import { cn } from '@/lib/utils'

const SLOT_DOT_CLASS: Record<SourceSlot, string> = {
  a: 'bg-blue-600 dark:bg-blue-500',
  b: 'bg-orange-600 dark:bg-orange-500',
}

export function CompareSlotTag({
  slot,
  label,
  side = 'left',
}: {
  slot: SourceSlot
  label: string
  side?: 'left' | 'right'
}) {
  return (
    <div
      className={cn(
        'absolute top-2 z-10 flex max-w-[70%] items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm backdrop-blur-sm',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', SLOT_DOT_CLASS[slot])}
      />
      <span className="font-mono font-bold">{slot.toUpperCase()}</span>
      <span className="truncate text-muted-foreground" title={label}>
        {label}
      </span>
    </div>
  )
}
