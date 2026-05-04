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
import { resolveAdapter } from './registry'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface MimeFilterChipsProps {
  /** All distinct MIMEs present in the run, in stable order. */
  availableMimes: ReadonlyArray<string>
  /** Currently active MIMEs; empty = "All". */
  activeMimes: ReadonlyArray<string>
  /** Item count per mime (post-sniff resolved). */
  counts: Readonly<Record<string, number>>
  /** Total count across all mimes (shown on the "All" chip). */
  total: number
  onChange: (next: ReadonlyArray<string>) => void
}

/** Sentinel value for the "All" chip inside the multi-select group. Picked
 * to avoid colliding with any real MIME string. */
const ALL_VALUE = '__all__'

/**
 * MIME filter row built on shadcn ToggleGroup with `multiple`. "All" sits
 * inside the group as a regular item; the onValueChange handler enforces
 * its semantics — selecting it clears the rest, selecting another mime
 * deselects it, and an empty selection re-activates it.
 */
export function MimeFilterChips({
  availableMimes,
  activeMimes,
  counts,
  total,
  onChange,
}: MimeFilterChipsProps) {
  const { t } = useTranslation('executions')
  const allActive = activeMimes.length === 0
  const groupValue = allActive ? [ALL_VALUE] : [...activeMimes]

  const handleValueChange = (next: Array<string>): void => {
    const hasAll = next.includes(ALL_VALUE)
    const mimes = next.filter((v) => v !== ALL_VALUE)

    // Clicking "All" while another filter was active → clear filter.
    if (hasAll && !allActive) {
      onChange([])
      return
    }
    // Empty selection → fall back to "All".
    if (mimes.length === 0) {
      onChange([])
      return
    }
    onChange(mimes)
  }

  return (
    <ToggleGroup
      multiple
      value={groupValue}
      onValueChange={handleValueChange}
      variant="outline"
    >
      <ToggleGroupItem
        value={ALL_VALUE}
        variant="outline"
        aria-label={t('outputs.filter.allMimes')}
        className="gap-1.5 font-mono text-xs"
      >
        <span>{t('outputs.filter.allMimes')}</span>
        <span className="text-muted-foreground tabular-nums">{total}</span>
      </ToggleGroupItem>
      {availableMimes.map((mime) => {
        const adapter = resolveAdapter(mime)
        const labelFn = adapter.shortLabel ?? adapter.label
        return (
          <ToggleGroupItem
            key={mime}
            value={mime}
            variant="outline"
            aria-label={labelFn(t)}
            className="gap-1.5 font-mono text-xs"
          >
            <span>{labelFn(t)}</span>
            <span className="text-muted-foreground tabular-nums">
              {counts[mime] ?? 0}
            </span>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
