/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Check, ChevronDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface EnumListFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  options: Array<string>
  placeholder?: string
  disabled?: boolean
  className?: string
}

function parseListValue(value: string): Array<string> {
  if (!value.trim()) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function serializeListValue(items: Array<string>): string {
  return items.join(',')
}

export function EnumListField({
  id,
  configKey,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: EnumListFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.selectPlaceholder')

  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      disabled={disabled}
      className={className}
      allowGlyphMode={false}
    >
      <EnumListFieldConcrete
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        className={className}
      />
    </GlyphFieldWrapper>
  )
}

function EnumListFieldConcrete({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: Omit<EnumListFieldProps, 'configKey'>) {
  const { t } = useTranslation('common')
  const selected = parseListValue(value)
  const selectedSet = new Set(selected)
  const resolvedPlaceholder = placeholder ?? t('field.selectPlaceholder')
  const buttonText =
    selected.length > 0 ? selected.join(', ') : resolvedPlaceholder

  function toggleOption(option: string): void {
    const nextSet = new Set(selectedSet)
    if (nextSet.has(option)) {
      nextSet.delete(option)
    } else {
      nextSet.add(option)
    }
    onChange(serializeListValue(options.filter((item) => nextSet.has(item))))
  }

  function removeOption(option: string): void {
    onChange(serializeListValue(selected.filter((item) => item !== option)))
  }

  return (
    <div className="min-w-0 space-y-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className={cn('h-9 w-full justify-between px-3', className)}
              disabled={disabled}
            />
          }
        >
          <span
            className={cn(
              'truncate',
              selected.length === 0 && 'text-muted-foreground',
            )}
          >
            {buttonText}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="max-h-72 w-(--anchor-width) gap-1 overflow-y-auto p-1">
          {options.map((option) => {
            const checked = selectedSet.has(option)
            return (
              <button
                key={option}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                  'outline-none hover:bg-accent hover:text-accent-foreground',
                )}
                onClick={() => toggleOption(option)}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {checked && <Check className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{option}</span>
              </button>
            )
          })}
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {selected.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 pr-1">
              {item}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeOption(item)}
                  className="ml-1 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
                  aria-label={t('removeTag', { tag: item })}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
