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
 * GlyphAutocomplete Component
 *
 * Dropdown of candidates for the current cursor position inside a `${...}`
 * expression. Driven by `parseGlyphContext`: shows variables + callable
 * helpers in `value` position, and pipe-style helper filters in `filter`
 * position. Supports keyboard navigation (arrow keys + Enter / Escape).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

export type AutocompleteSource =
  | 'local'
  | 'global'
  | 'intrinsic'
  | 'filter'
  | 'helperGlobal'

export interface AutocompleteCandidate {
  /** Identifier inserted on selection. */
  name: string
  /** Display label; for intrinsics this is friendlier than `name`. */
  displayName: string
  /** Right-aligned meta text (value example or backend description). */
  meta: string
  /** Drives section header, ordering, and badge. */
  source: AutocompleteSource
}

export type AutocompleteContextKind = 'value' | 'filter'

interface GlyphAutocompleteProps {
  candidates: Array<AutocompleteCandidate>
  filter: string
  contextKind: AutocompleteContextKind
  onSelect: (candidate: AutocompleteCandidate) => void
  onClose: () => void
}

const VALUE_SECTION_ORDER: ReadonlyArray<AutocompleteSource> = [
  'local',
  'global',
  'intrinsic',
  'helperGlobal',
]
const FILTER_SECTION_ORDER: ReadonlyArray<AutocompleteSource> = ['filter']

export function GlyphAutocomplete({
  candidates,
  filter,
  contextKind,
  onSelect,
  onClose,
}: GlyphAutocompleteProps) {
  const { t } = useTranslation('glyphs')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const query = filter.toLowerCase()
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.displayName.toLowerCase().includes(query),
    )
  }, [candidates, filter])

  const sectionOrder =
    contextKind === 'filter' ? FILTER_SECTION_ORDER : VALUE_SECTION_ORDER

  // Group filtered candidates by source, preserving the section order so the
  // flat `allItems` index aligns with what the user sees vertically.
  const grouped = useMemo(() => {
    const bySource = new Map<AutocompleteSource, Array<AutocompleteCandidate>>()
    for (const c of filtered) {
      const arr = bySource.get(c.source) ?? []
      arr.push(c)
      bySource.set(c.source, arr)
    }
    return sectionOrder
      .map((source) => ({ source, items: bySource.get(source) ?? [] }))
      .filter((g) => g.items.length > 0)
  }, [filtered, sectionOrder])

  const allItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  useEffect(() => {
    setActiveIndex(0)
  }, [filter, contextKind])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, allItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && allItems.length > 0) {
        e.preventDefault()
        onSelect(allItems[activeIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [allItems, activeIndex, onSelect, onClose])

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (allItems.length === 0) return null

  let itemIndex = 0

  return (
    <div
      ref={listRef}
      className="max-h-60 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
    >
      {grouped.map((group, groupIdx) => {
        const label =
          group.source === 'local'
            ? t('panel.local')
            : group.source === 'global'
              ? t('panel.global')
              : group.source === 'intrinsic'
                ? t('panel.intrinsic')
                : t('panel.helpers.title')
        return (
          <div key={group.source}>
            {groupIdx > 0 && <div className="my-1 border-t border-border" />}
            <P className="px-2 py-1 text-sm font-medium text-muted-foreground">
              {label}
            </P>
            {group.items.map((c) => {
              const idx = itemIndex++
              return (
                <AutocompleteItem
                  key={`${c.source}:${c.name}`}
                  candidate={c}
                  active={idx === activeIndex}
                  onSelect={() => onSelect(c)}
                  onHover={() => setActiveIndex(idx)}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function AutocompleteItem({
  candidate,
  active,
  onSelect,
  onHover,
}: {
  candidate: AutocompleteCandidate
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  const { t } = useTranslation('glyphs')
  const badge =
    candidate.source === 'filter'
      ? t('panel.helpers.filterBadge')
      : candidate.source === 'helperGlobal'
        ? t('panel.helpers.globalBadge')
        : null

  return (
    <button
      type="button"
      data-active={active}
      onMouseDown={(e) => {
        e.preventDefault() // prevent input blur
        onSelect()
      }}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <code className="shrink-0 font-mono text-sm font-medium">
        {candidate.name}
      </code>
      {badge && (
        <span
          className={cn(
            'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase',
            candidate.source === 'filter'
              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              : 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
          )}
        >
          {badge}
        </span>
      )}
      <span className="min-w-0 truncate text-muted-foreground">
        {candidate.meta}
      </span>
    </button>
  )
}
