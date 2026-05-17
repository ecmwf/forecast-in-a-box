/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Chips-style tag editor. Commits the draft tag on Enter, comma or blur. */

import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'

interface TagInputProps {
  tags: Array<string>
  onTagsChange: (tags: Array<string>) => void
  id?: string
  placeholder?: string
}

export function TagInput({
  tags,
  onTagsChange,
  id,
  placeholder,
}: TagInputProps) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState('')

  function addTag(value: string) {
    const trimmed = value.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onTagsChange([...tags, trimmed])
    }
  }

  /** A comma (typed or pasted) commits every part but the last. */
  function handleChange(value: string) {
    if (!value.includes(',')) {
      setDraft(value)
      return
    }
    const next = [...tags]
    const parts = value.split(',')
    for (const part of parts.slice(0, -1)) {
      const trimmed = part.trim()
      if (trimmed && !next.includes(trimmed)) next.push(trimmed)
    }
    onTagsChange(next)
    setDraft(parts[parts.length - 1] ?? '')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addTag(draft)
      setDraft('')
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      onTagsChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            onClick={() => onTagsChange(tags.filter((x) => x !== tag))}
            aria-label={t('removeTag', { tag })}
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            addTag(draft)
            setDraft('')
          }
        }}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
