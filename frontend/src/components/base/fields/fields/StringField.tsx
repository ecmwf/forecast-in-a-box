/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useGlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { GlyphAutocomplete } from '@/features/fable-builder/components/shared/GlyphAutocomplete'
import {
  containsGlyphs,
  resolveGlyphValue,
} from '@/features/fable-builder/utils/glyph-display'

export interface StringFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * Detects an open ${ pattern before the cursor position and returns the
 * partial filter text, or null if autocomplete should not trigger.
 */
function detectGlyphTrigger(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos)
  const triggerIndex = before.lastIndexOf('${')
  if (triggerIndex === -1) return null

  const afterTrigger = before.slice(triggerIndex + 2)
  // Only trigger if we haven't closed the brace yet
  if (afterTrigger.includes('}')) return null
  // Only allow word characters in the partial
  if (!/^\w*$/.test(afterTrigger)) return null

  return afterTrigger
}

export function StringField({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: StringFieldProps) {
  const { t } = useTranslation('glyphs')
  const glyphs = useGlyphContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [autocompleteFilter, setAutocompleteFilter] = useState<string | null>(
    null,
  )
  const [cursorPos, setCursorPos] = useState(0)

  const hasGlyphs = glyphs.length > 0

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      const pos = e.target.selectionStart ?? newValue.length
      setCursorPos(pos)
      onChange(newValue)

      if (hasGlyphs) {
        setAutocompleteFilter(detectGlyphTrigger(newValue, pos))
      }
    },
    [onChange, hasGlyphs],
  )

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const pos = e.currentTarget.selectionStart ?? value.length
      setCursorPos(pos)
      if (hasGlyphs) {
        setAutocompleteFilter(detectGlyphTrigger(value, pos))
      }
    },
    [value, hasGlyphs],
  )

  const handleSelect = useCallback(
    (glyphName: string) => {
      // Find the ${ trigger position before cursor
      const before = value.slice(0, cursorPos)
      const triggerIndex = before.lastIndexOf('${')
      if (triggerIndex === -1) return

      const newValue =
        value.slice(0, triggerIndex) +
        '${' +
        glyphName +
        '}' +
        value.slice(cursorPos)
      onChange(newValue)
      setAutocompleteFilter(null)

      // Restore focus and move cursor after the inserted glyph
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          const newPos = triggerIndex + glyphName.length + 3 // ${ + name + }
          input.setSelectionRange(newPos, newPos)
        }
      })
    },
    [value, cursorPos, onChange],
  )

  const handleClose = useCallback(() => {
    setAutocompleteFilter(null)
  }, [])

  const handleBlur = useCallback(() => {
    // Delay close to allow mousedown on autocomplete items
    setTimeout(() => setAutocompleteFilter(null), 150)
  }, [])

  // Build resolved preview
  const showPreview = hasGlyphs && containsGlyphs(value)
  const resolvedPreview = showPreview
    ? resolveGlyphValue(
        value,
        Object.fromEntries(glyphs.map((g) => [g.name, g.valueExample])),
      )
    : null

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={hasGlyphs ? false : undefined}
        autoComplete="off"
        className={className}
      />

      {autocompleteFilter !== null && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1">
          <GlyphAutocomplete
            glyphs={glyphs}
            filter={autocompleteFilter}
            onSelect={handleSelect}
            onClose={handleClose}
          />
        </div>
      )}

      {resolvedPreview && resolvedPreview !== value && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="mt-1 truncate text-sm text-muted-foreground italic" />
            }
          >
            {t('panel.resolvesTo')}{' '}
            <span className="font-mono">{resolvedPreview}</span>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-96 font-mono break-all"
          >
            {resolvedPreview}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
