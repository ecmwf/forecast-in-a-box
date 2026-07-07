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
 * One basket source as a clickable chip. The active pair is marked with
 * A/B slot badges in the two fixed comparison hues (A blue / B orange) —
 * the same pair of colors identifies the sources in panel tags,
 * availability chips, and the time-availability tracks.
 */

import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDisplayName } from '../entry-ref'
import type { ComparisonEntry } from '../entry-ref'
import { cn } from '@/lib/utils'
import { formatInZone, useAppTimeZone } from '@/lib/datetime'

export const SLOT_BADGE_CLASS = {
  A: 'bg-blue-600 text-white dark:bg-blue-500',
  B: 'bg-orange-600 text-white dark:bg-orange-500',
} as const

const SLOT_RING_CLASS = {
  A: 'border-blue-600 ring-1 ring-blue-600 dark:border-blue-500 dark:ring-blue-500',
  B: 'border-orange-600 ring-1 ring-orange-600 dark:border-orange-500 dark:ring-orange-500',
} as const

export function CompareBasketChip({
  entry,
  slot,
  onActivate,
  onRemove,
}: {
  entry: ComparisonEntry
  slot: 'A' | 'B' | null
  onActivate: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('compare')
  const timeZone = useAppTimeZone()
  const name = entryDisplayName(entry)

  const sub =
    entry.kind === 'output'
      ? [
          entry.runName && entry.blockTitle !== entry.runName
            ? entry.blockTitle
            : null,
          entry.runCreatedAt
            ? formatInZone(new Date(entry.runCreatedAt), timeZone, 'yyyy-MM-dd')
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null
  const kindTag =
    entry.kind === 'path'
      ? t('basket.kindPath')
      : entry.kind === 'wms'
        ? t('basket.kindWms')
        : null

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-card py-1.5 pr-1.5 pl-2.5 text-sm transition-colors',
        slot ? SLOT_RING_CLASS[slot] : 'border-border hover:border-primary/40',
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex min-w-0 items-center gap-2 text-left"
        title={t('basket.setActive')}
      >
        {slot && (
          <span
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
              SLOT_BADGE_CLASS[slot],
            )}
          >
            {slot}
          </span>
        )}
        <span className="min-w-0">
          <span className="block max-w-48 truncate font-medium" title={name}>
            {name}
          </span>
          {sub && (
            <span className="block max-w-48 truncate text-xs text-muted-foreground">
              {sub}
            </span>
          )}
        </span>
        {kindTag && (
          <span className="rounded border border-border px-1 font-mono text-[10px] tracking-wide text-muted-foreground">
            {kindTag}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('basket.remove', { name })}
        title={t('basket.remove', { name })}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
