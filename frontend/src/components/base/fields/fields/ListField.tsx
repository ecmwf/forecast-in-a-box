/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ListFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * Parse a comma-separated string into an array of strings
 */
function parseListValue(value: string): Array<string> {
  if (!value.trim()) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Serialize an array of strings into a comma-separated string
 */
function serializeListValue(items: Array<string>): string {
  return items.join(',')
}

export function ListField({
  id,
  value,
  onChange,
  placeholder = 'Add item...',
  disabled,
  className,
}: ListFieldProps) {
  const [inputValue, setInputValue] = useState('')
  const items = parseListValue(value)

  const addItem = useCallback(
    (newItem: string) => {
      const trimmed = newItem.trim()
      if (!trimmed || items.includes(trimmed)) return

      const newItems = [...items, trimmed]
      onChange(serializeListValue(newItems))
      setInputValue('')
    },
    [items, onChange],
  )

  const removeItem = useCallback(
    (index: number) => {
      const newItems = items.filter((_, i) => i !== index)
      onChange(serializeListValue(newItems))
    },
    [items, onChange],
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && items.length > 0) {
      removeItem(items.length - 1)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <Badge
            key={`${item}-${index}`}
            variant="secondary"
            className="gap-1 pr-1"
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="ml-1 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
                aria-label={`Remove ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <Input
        id={id}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) {
            addItem(inputValue)
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  )
}
