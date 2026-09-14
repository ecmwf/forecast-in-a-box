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
 * entries with a swap button between them. B is cleared via a dedicated
 * X (never a fake Select item — a controlled Select re-commits its old
 * value on animated close, resurrecting B); each list chips the slots a
 * row occupies, so picking the other slot's row self-compares.
 */

import { ArrowLeftRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDetail, entryRef } from '../entry-ref'
import { slotCaption } from '../slot-caption'
import type { TFunction } from 'i18next'
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
import { useAppTimeZone } from '@/lib/datetime'

const SLOT_BADGE: Record<'a' | 'b', string> = {
  a: 'bg-slot-a text-white',
  b: 'bg-slot-b text-white',
}

export function CompareSlotBar({
  entries,
  aRef,
  bRef,
  onAssign,
  onSwap,
  onClearSlot,
}: {
  entries: ReadonlyArray<ComparisonEntry>
  aRef: string | undefined
  bRef: string | undefined
  /** Plain assignment — picking the other slot's source self-compares, never swaps. */
  onAssign: (slot: 'a' | 'b', ref: string) => void
  onSwap: () => void
  /** Remove one slot from the view; the other continues solo. */
  onClearSlot: (slot: 'a' | 'b') => void
}) {
  const { t } = useTranslation('visualise')

  return (
    // Below lg the B group takes its own row and the swap trails it, so
    // both rows lead with their slot badge (A over B, aligned).
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="flex max-w-full min-w-0 items-center gap-2 lg:flex-1">
        <SlotPicker
          slot="a"
          entries={entries}
          value={aRef}
          onChange={(ref) => onAssign('a', ref)}
          markRef={bRef}
        />
        {bRef && <ClearSlotButton slot="a" onClear={() => onClearSlot('a')} />}
      </div>
      <div className="flex max-w-full min-w-0 items-center gap-2 max-lg:w-full lg:flex-1">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 max-lg:order-last"
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
          markRef={aRef}
        />
        {bRef && <ClearSlotButton slot="b" onClear={() => onClearSlot('b')} />}
      </div>
    </div>
  )
}

/** X while comparing: removes the slot from view, not from the basket. */
function ClearSlotButton({
  slot,
  onClear,
}: {
  slot: 'a' | 'b'
  onClear: () => void
}) {
  const { t } = useTranslation('visualise')
  const label = t('slots.clearSlot', {
    slot: slot.toUpperCase(),
    other: slot === 'a' ? 'B' : 'A',
  })
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ml-1 h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClear}
      aria-label={label}
      title={label}
    >
      <X className="h-4 w-4" />
    </Button>
  )
}

/** Second line of a picker: what the source is, in the caption's words. */
function triggerMeta(
  entry: ComparisonEntry,
  timeZone: string,
  t: TFunction<'visualise'>,
): string {
  const { detail } = entryDetail(entry)
  if (entry.kind !== 'output') return detail
  const { label, submittedAt } = slotCaption(entry, timeZone)
  const parts = [
    submittedAt ? t('slotTag.submitted', { time: submittedAt }) : null,
    entry.blockTitle && entry.blockTitle !== label ? entry.blockTitle : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

function SlotPicker({
  slot,
  entries,
  value,
  onChange,
  markRef,
}: {
  slot: 'a' | 'b'
  entries: ReadonlyArray<ComparisonEntry>
  value: string | undefined
  onChange: (ref: string) => void
  /** The other slot's current ref — rows chip every slot they occupy. */
  markRef?: string
}) {
  const { t } = useTranslation('visualise')
  const timeZone = useAppTimeZone()
  const current = entries.find((e) => entryRef(e) === value)
  const caption = current ? slotCaption(current, timeZone) : null
  return (
    <div className="flex max-w-full min-w-0 items-center gap-1.5 lg:flex-1">
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold',
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
        {/* lg+: two lines and share the row's width (capped); else one compact line. */}
        <SelectTrigger
          className="h-9 w-64 max-w-full min-w-0 text-sm *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 lg:h-auto! lg:w-full lg:max-w-104 lg:py-1.5 lg:*:data-[slot=select-value]:line-clamp-none"
          aria-label={t('slots.pickerAria', { slot: slot.toUpperCase() })}
        >
          {/* Base UI shows the raw value for programmatically-set
              selections — render the display name explicitly. */}
          <SelectValue placeholder={t('slots.placeholder')}>
            {current && caption ? (
              <span className="flex w-full min-w-0 flex-col items-start text-left">
                <span className="flex max-w-full min-w-0 items-baseline gap-1.5">
                  <span className="min-w-0 truncate">{caption.label}</span>
                  {caption.submittedAt && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums lg:hidden">
                      {caption.submittedAt}
                    </span>
                  )}
                </span>
                <span className="max-w-full min-w-0 truncate text-xs font-normal text-muted-foreground max-lg:hidden">
                  {triggerMeta(current, timeZone, t)}
                </span>
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-xl min-w-[360px]">
          {entries.map((entry) => {
            const ref = entryRef(entry)
            const { kind, detail } = entryDetail(entry)
            const { label, submittedAt } = slotCaption(entry, timeZone)
            // One chip per slot the row occupies (both on self-compare).
            const chipSlots = (['a', 'b'] as const).filter((s) =>
              s === slot ? ref === value : ref === markRef,
            )
            return (
              <SelectItem
                key={ref}
                value={ref}
                className="py-2 pr-2 [&_svg]:hidden"
              >
                {/* divs: the item styles its last SPAN child as a flex row. */}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* flex-1 keeps the slot chips in a right-hand column. */}
                    {/* whitespace-normal: the ItemText wrapper is nowrap. */}
                    <span
                      className="line-clamp-2 min-w-0 flex-1 break-words whitespace-normal"
                      title={label}
                    >
                      {label}
                    </span>
                    {chipSlots.map((s) => (
                      <span
                        key={s}
                        title={t('slots.inSlot', { slot: s.toUpperCase() })}
                        className={cn(
                          'shrink-0 rounded-md px-1 font-mono text-[10px] font-bold',
                          SLOT_BADGE[s],
                        )}
                      >
                        {s.toUpperCase()}
                      </span>
                    ))}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0 rounded-md bg-muted px-1 font-mono text-[10px] uppercase">
                      {t(`slots.kind.${kind}`)}
                    </span>
                    <span className="min-w-0 truncate font-mono">{detail}</span>
                    {submittedAt && (
                      <span className="shrink-0 tabular-nums">
                        {t('slotTag.submitted', { time: submittedAt })}
                      </span>
                    )}
                  </div>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
