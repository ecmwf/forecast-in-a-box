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
 * Faceted search field — free text plus `key:value` filter tokens (`model:`,
 * `output:`, `tag:`), rendered as removable chips. Enter commits, Backspace pops.
 */

import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KeyboardEvent } from 'react'
import type { FacetKey } from '@/features/journal/facets/facet-types'
import {
  parseQuery,
  removeToken,
  serializeQuery,
} from '@/features/journal/facets/parse-query'
import { Badge } from '@/components/ui/badge'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'

export function FacetSearchBar({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('journal')
  const [draft, setDraft] = useState('')
  const { tokens, text } = parseQuery(value)
  const hasChips = tokens.length > 0 || text.length > 0

  function commitDraft() {
    if (!draft.trim()) return
    onChange(`${value} ${draft}`.trim())
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
    } else if (event.key === 'Backspace' && !draft) {
      // Pop the last chip — free text first, then the newest token.
      if (text) onChange(serializeQuery({ tokens, text: '' }))
      else if (tokens.length > 0)
        onChange(removeToken(value, tokens[tokens.length - 1]))
    }
  }

  return (
    <InputGroup className="h-auto min-h-9 w-full flex-wrap items-center gap-1.5 px-2.5 py-1 sm:w-[30rem]">
      {tokens.map((token) => (
        <Badge
          key={`${token.key}:${token.value}`}
          variant="secondary"
          className="gap-1 pr-1"
        >
          <span className="text-muted-foreground">
            {t(facetLabelKey(token.key))}:
          </span>
          {token.value}
          <ChipRemove
            label={t('clearFilters')}
            onClick={() => onChange(removeToken(value, token))}
          />
        </Badge>
      ))}
      {text && (
        <Badge variant="secondary" className="gap-1 pr-1">
          {text}
          <ChipRemove
            label={t('clearFilters')}
            onClick={() => onChange(serializeQuery({ tokens, text: '' }))}
          />
        </Badge>
      )}

      <InputGroupInput
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder={hasChips ? '' : t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        className="h-7 min-w-[6rem] flex-1 !px-0"
      />
    </InputGroup>
  )
}

/** The `×` button shared by every search chip. */
function ChipRemove({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
    >
      <X className="h-3 w-3" />
    </button>
  )
}

/** Map a facet key to its statically-known i18n label key. */
function facetLabelKey(
  key: FacetKey,
): 'facet.model' | 'facet.output' | 'facet.tag' | 'facet.date' {
  if (key === 'model') return 'facet.model'
  if (key === 'output') return 'facet.output'
  if (key === 'date') return 'facet.date'
  return 'facet.tag'
}
