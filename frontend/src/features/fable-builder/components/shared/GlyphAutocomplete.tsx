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
 * Dropdown list of available glyphs, triggered when user types ${ in a config field.
 * Supports keyboard navigation (arrow keys + Enter) and filtering by partial input.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GlyphInfo } from '@/features/fable-builder/hooks/useAllGlyphs'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface GlyphAutocompleteProps {
  glyphs: Array<GlyphInfo>
  filter: string
  onSelect: (glyphName: string) => void
  onClose: () => void
}

export function GlyphAutocomplete({
  glyphs,
  filter,
  onSelect,
  onClose,
}: GlyphAutocompleteProps) {
  const { t } = useTranslation('glyphs')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const query = filter.toLowerCase()
  const filtered = glyphs.filter(
    (g) =>
      g.name.toLowerCase().includes(query) ||
      g.displayName.toLowerCase().includes(query),
  )

  const intrinsic = filtered.filter((g) => g.type === 'intrinsic')
  const global = filtered.filter((g) => g.type === 'global')
  const allItems = [...global, ...intrinsic]

  useEffect(() => {
    setActiveIndex(0)
  }, [filter])

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
        onSelect(allItems[activeIndex].name)
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
      className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
    >
      {global.length > 0 && (
        <>
          <P className="px-2 py-1 text-sm font-medium text-muted-foreground">
            {t('panel.global')}
          </P>
          {global.map((g) => {
            const idx = itemIndex++
            return (
              <AutocompleteItem
                key={g.name}
                glyph={g}
                active={idx === activeIndex}
                onSelect={() => onSelect(g.name)}
                onHover={() => setActiveIndex(idx)}
              />
            )
          })}
        </>
      )}
      {intrinsic.length > 0 && (
        <>
          {global.length > 0 && <div className="my-1 border-t border-border" />}
          <P className="px-2 py-1 text-sm font-medium text-muted-foreground">
            {t('panel.intrinsic')}
          </P>
          {intrinsic.map((g) => {
            const idx = itemIndex++
            return (
              <AutocompleteItem
                key={g.name}
                glyph={g}
                active={idx === activeIndex}
                onSelect={() => onSelect(g.name)}
                onHover={() => setActiveIndex(idx)}
              />
            )
          })}
        </>
      )}
    </div>
  )
}

function AutocompleteItem({
  glyph,
  active,
  onSelect,
  onHover,
}: {
  glyph: GlyphInfo
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  return (
    <button
      type="button"
      data-active={active}
      onMouseDown={(e) => {
        e.preventDefault() // Prevent input blur
        onSelect()
      }}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-sm',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <code className="shrink-0 font-mono text-sm font-medium">
        {glyph.name}
      </code>
      <span className="min-w-0 truncate text-muted-foreground">
        {glyph.type === 'intrinsic' ? glyph.displayName : glyph.valueExample}
      </span>
    </button>
  )
}
