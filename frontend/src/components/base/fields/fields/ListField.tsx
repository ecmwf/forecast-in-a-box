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
import { useTranslation } from 'react-i18next'
import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import { ParamHintTooltip } from './ParamOptionLabel'
import type { KeyboardEvent } from 'react'
import type { DisplayLookup } from '@/components/base/fields/value-type-parser'
import { paramLabel } from '@/components/base/fields/param-display'
import { useParamLabels } from '@/api/hooks/useFable'
import { Badge } from '@/components/ui/badge'
import { InputGroupInput } from '@/components/ui/input-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ListFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /**
   * Item type the backend expects for entries. `'int'` rejects entries that
   * aren't parseable integers and hints the keyboard to numeric.
   */
  itemType?: 'string' | 'int'
  /** Label entries via a backend lookup; the stored value stays the id. */
  lookup?: DisplayLookup
}

const NO_ITEMS: Array<string> = []

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

export function isIntegerString(raw: string): boolean {
  return /^-?\d+$/.test(raw)
}

export function ListField({
  id,
  configKey,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  itemType = 'string',
  lookup,
}: ListFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.addItemPlaceholder')
  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      disabled={disabled}
      className={className}
    >
      <ListFieldConcrete
        id={id}
        value={value}
        onChange={onChange}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        itemType={itemType}
        lookup={lookup}
      />
    </GlyphFieldWrapper>
  )
}

function ListFieldConcrete({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  itemType = 'string',
  lookup,
}: Omit<ListFieldProps, 'configKey'>) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.addItemPlaceholder')
  const [inputValue, setInputValue] = useState('')
  const items = parseListValue(value)
  const labels = useParamLabels(lookup === 'param' ? items : NO_ITEMS)

  const addItem = useCallback(
    (newItem: string) => {
      // Split on commas so pasting or typing "a, b, c" produces three chips,
      // not one chip whose stored value round-trips as " b"/" c" and fails
      // backend validation (params split by "," without trimming).
      const tokens = newItem
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (tokens.length === 0) return

      const toAdd: Array<string> = []
      for (const token of tokens) {
        if (itemType === 'int' && !isIntegerString(token)) continue
        if (items.includes(token) || toAdd.includes(token)) continue
        toAdd.push(token)
      }
      if (toAdd.length === 0) {
        setInputValue('')
        return
      }

      onChange(serializeListValue([...items, ...toAdd]))
      setInputValue('')
    },
    [items, itemType, onChange],
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

  // data-slot opts into InputGroup's h-auto + items-stretch so the field
  // grows when chips wrap and the inline-start `{}` toggle stays aligned.
  return (
    <TooltipProvider delay={120}>
      <div
        data-slot="input-group-content"
        className={cn(
          'flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1',
          className,
        )}
      >
        {items.map((item, index) => (
          <ParamHintTooltip key={`${item}-${index}`} id={item} labels={labels}>
            <Badge variant="secondary" className="gap-1 pr-1">
              {paramLabel(item, labels, 'compact')}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="ml-1 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
                  aria-label={t('removeTag', {
                    tag: paramLabel(item, labels, 'full'),
                  })}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          </ParamHintTooltip>
        ))}
        <InputGroupInput
          id={id}
          type="text"
          inputMode={itemType === 'int' ? 'numeric' : undefined}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) {
              addItem(inputValue)
            }
          }}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          className="h-7 min-w-[6rem] flex-1 !px-0"
        />
      </div>
    </TooltipProvider>
  )
}
