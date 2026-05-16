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
 * TimeZoneSelect — a searchable combobox over the full IANA timezone list.
 *
 * Keyboard: type to filter, Arrow keys to move, Enter to choose. With an empty
 * query, UTC and the browser's zone are pinned at the top for quick access.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { listTimeZones, timeZoneOffsetLabel } from '@/lib/datetime'
import { cn } from '@/lib/utils'

export interface TimeZoneSelectProps {
  /** The currently selected IANA timezone identifier. */
  value: string
  /** Called with the chosen IANA timezone identifier. */
  onChange: (timeZone: string) => void
  className?: string
}

/** The browser's IANA zone, or null when it is UTC or undetectable. */
function detectBrowserTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && tz !== 'UTC' ? tz : null
  } catch {
    return null
  }
}

const prettyName = (tz: string) => tz.replace(/_/g, ' ')

export function TimeZoneSelect({
  value,
  onChange,
  className,
}: TimeZoneSelectProps) {
  const baseId = useId()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const allZones = useMemo(() => listTimeZones(), [])
  const browserTz = useMemo(() => detectBrowserTimeZone(), [])

  // Offset labels are stable for the component's lifetime; compute them once
  // so a highlight change (fired on hover) doesn't recompute ~400 of them.
  const offsetLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const tz of allZones) labels.set(tz, timeZoneOffsetLabel(tz))
    return labels
  }, [allZones])

  const search = query.trim().toLowerCase()
  const items = useMemo(() => {
    if (search) {
      return allZones.filter((tz) =>
        prettyName(tz).toLowerCase().includes(search),
      )
    }
    // Empty query: surface UTC and the browser zone at the top.
    const pinned = ['UTC', ...(browserTz ? [browserTz] : [])]
    return [...pinned, ...allZones.filter((tz) => !pinned.includes(tz))]
  }, [allZones, browserTz, search])

  // The pinned group only exists while the query is empty.
  const pinnedCount = search ? 0 : 1 + (browserTz ? 1 : 0)

  // Highlight the first match while searching, otherwise the current value.
  useEffect(() => {
    setHighlighted(search ? 0 : Math.max(0, items.indexOf(value)))
  }, [search, items, value])

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const tz = items[highlighted]
      if (tz) onChange(tz)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          role="combobox"
          aria-controls={`${baseId}-list`}
          aria-expanded
          aria-activedescendant={
            items.length ? `${baseId}-opt-${highlighted}` : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search timezone…"
          className="pl-8"
          aria-label="Search timezone"
        />
      </div>
      <div
        ref={listRef}
        id={`${baseId}-list`}
        role="listbox"
        aria-label="Timezones"
        className="max-h-80 overflow-y-auto rounded-md border border-border"
      >
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No timezone found.
          </p>
        ) : (
          items.map((tz, index) => (
            <button
              key={tz}
              id={`${baseId}-opt-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              data-highlighted={index === highlighted}
              aria-selected={tz === value}
              onClick={() => onChange(tz)}
              onMouseEnter={() => setHighlighted(index)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                index === highlighted && 'bg-muted',
                pinnedCount > 0 &&
                  index === pinnedCount - 1 &&
                  'border-b border-border',
              )}
            >
              <Check
                className={cn(
                  'size-4 shrink-0',
                  tz === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {prettyName(tz)}
                {tz === browserTz && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    · Browser
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {offsetLabels.get(tz)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
