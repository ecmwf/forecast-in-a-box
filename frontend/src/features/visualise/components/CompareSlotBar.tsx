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
 * value on animated close, resurrecting B); A's entry is badged in the
 * B list, so picking it is the discoverable self-compare path.
 */

import { ArrowLeftRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDetail, entryDisplayName, entryRef } from '../entry-ref'
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
import { formatInZone, useAppTimeZone } from '@/lib/datetime'

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
  onSingleView,
}: {
  entries: ReadonlyArray<ComparisonEntry>
  aRef: string | undefined
  bRef: string | undefined
  /** Assign `ref` to `slot`; assigning the other slot's source swaps. */
  onAssign: (slot: 'a' | 'b', ref: string) => void
  onSwap: () => void
  /** Clear B back to a single-source view. */
  onSingleView: () => void
}) {
  const { t } = useTranslation('visualise')

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
        markRef={aRef}
      />
      {bRef && (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onSingleView}
          aria-label={t('slots.singleView')}
          title={t('slots.singleView')}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

/** Trigger-suffix that distinguishes same-named sources at a glance. */
function triggerSuffix(
  entry: ComparisonEntry,
  timeZone: string,
): string | null {
  if (entry.kind === 'output' && entry.runCreatedAt) {
    return formatInZone(new Date(entry.runCreatedAt), timeZone, 'dd MMM HH:mm')
  }
  // wms/path labels already carry their host / directory name.
  return null
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
  /** Badge this entry as the other slot's current source (self-compare hint). */
  markRef?: string
}) {
  const { t } = useTranslation('visualise')
  const timeZone = useAppTimeZone()
  const current = entries.find((e) => entryRef(e) === value)
  const suffix = current ? triggerSuffix(current, timeZone) : null
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
          className="h-9 w-64 text-sm"
          aria-label={t('slots.pickerAria', { slot: slot.toUpperCase() })}
        >
          {/* Base UI shows the raw value for programmatically-set
              selections — render the display name explicitly. */}
          <SelectValue placeholder={t('slots.placeholder')}>
            {current ? (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="min-w-0 truncate">
                  {entryDisplayName(current)}
                </span>
                {suffix && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {suffix}
                  </span>
                )}
              </span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="min-w-[360px]">
          {entries.map((entry) => {
            const ref = entryRef(entry)
            const { kind, detail } = entryDetail(entry)
            const date = triggerSuffix(entry, timeZone)
            return (
              <SelectItem key={ref} value={ref}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">
                      {entryDisplayName(entry)}
                    </span>
                    {markRef === ref && (
                      <span
                        title={t('slots.isA')}
                        className={cn(
                          'rounded px-1 font-mono text-[10px] font-bold',
                          SLOT_BADGE.a,
                        )}
                      >
                        A
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1 font-mono text-[10px] uppercase">
                      {t(`slots.kind.${kind}`)}
                    </span>
                    <span className="truncate font-mono">{detail}</span>
                    {date && (
                      <span className="shrink-0 tabular-nums">{date}</span>
                    )}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
