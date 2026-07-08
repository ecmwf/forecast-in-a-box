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
 * First-class A/B slot assignment: two labelled pickers over the basket
 * entries with an explicit swap button between them — replaces the old
 * invisible "click a chip to make it B" gesture. Picking the other slot's
 * current source swaps the pair.
 */

import { ArrowLeftRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDisplayName, entryRef } from '../entry-ref'
import type { ComparisonEntry } from '../entry-ref'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const SLOT_BADGE: Record<'a' | 'b', string> = {
  a: 'bg-blue-600 text-white dark:bg-blue-500',
  b: 'bg-orange-600 text-white dark:bg-orange-500',
}

export function CompareSlotBar({
  entries,
  aRef,
  bRef,
  onAssign,
  onSwap,
}: {
  entries: ReadonlyArray<ComparisonEntry>
  aRef: string | undefined
  bRef: string | undefined
  /** Assign `ref` to `slot`; assigning the other slot's source swaps. */
  onAssign: (slot: 'a' | 'b', ref: string) => void
  onSwap: () => void
}) {
  const { t } = useTranslation('compare')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SlotPicker
        slot="a"
        entries={entries}
        value={aRef}
        onChange={(ref) => onAssign('a', ref)}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={onSwap}
        disabled={!aRef || !bRef}
        aria-label={t('slots.swap')}
        title={t('slots.swap')}
      >
        <ArrowLeftRight className="h-4 w-4" />
      </Button>
      <SlotPicker
        slot="b"
        entries={entries}
        value={bRef}
        onChange={(ref) => onAssign('b', ref)}
      />
    </div>
  )
}

function SlotPicker({
  slot,
  entries,
  value,
  onChange,
}: {
  slot: 'a' | 'b'
  entries: ReadonlyArray<ComparisonEntry>
  value: string | undefined
  onChange: (ref: string) => void
}) {
  const { t } = useTranslation('compare')
  const current = entries.find((e) => entryRef(e) === value)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-xs font-bold',
          SLOT_BADGE[slot],
        )}
      >
        {slot.toUpperCase()}
      </span>
      <Select
        value={value ?? ''}
        onValueChange={(ref) => {
          if (typeof ref === 'string' && ref) onChange(ref)
        }}
      >
        <SelectTrigger
          className="h-9 w-56 text-sm"
          aria-label={t('slots.pickerAria', { slot: slot.toUpperCase() })}
        >
          {/* Base UI shows the raw value for programmatically-set
              selections — render the display name explicitly. */}
          <SelectValue placeholder={t('slots.placeholder')}>
            {current ? entryDisplayName(current) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {entries.map((entry) => {
            const ref = entryRef(entry)
            return (
              <SelectItem key={ref} value={ref}>
                {entryDisplayName(entry)}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
