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
 * GlyphTextInput — Reusable glyph-aware text input.
 *
 * Provides ${…} autocomplete triggered by typing `${`, a "resolves to" preview,
 * and keyboard navigation. Extracted from StringField so it can be reused by
 * GlyphFieldWrapper when any field type switches to glyph mode.
 *
 * When `grouped` is true, renders an InputGroupInput (for use inside an
 * InputGroup) instead of a standalone Input.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { InputGroupInput } from '@/components/ui/input-group'
import { useGlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { GlyphAutocomplete } from '@/features/fable-builder/components/shared/GlyphAutocomplete'

export interface GlyphTextInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** When true, renders InputGroupInput instead of Input (for use inside InputGroup) */
  grouped?: boolean
  /** When true, auto-inserts ${ and opens the autocomplete on mount */
  autoTrigger?: boolean
  /** Called when the input blurs with an empty value (used by wrapper to exit glyph mode) */
  onBlurEmpty?: () => void
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

export function GlyphTextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  grouped = false,
  autoTrigger = false,
  onBlurEmpty,
}: GlyphTextInputProps) {
  const glyphs = useGlyphContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [autocompleteFilter, setAutocompleteFilter] = useState<string | null>(
    null,
  )
  const [cursorPos, setCursorPos] = useState(0)

  const hasGlyphs = glyphs.length > 0

  // Auto-insert ${ and open autocomplete when entering glyph mode on an empty field
  const didAutoTrigger = useRef(false)
  useEffect(() => {
    if (autoTrigger && hasGlyphs && !value && !didAutoTrigger.current) {
      didAutoTrigger.current = true
      onChange('${')
      setCursorPos(2)
      setAutocompleteFilter('')
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          input.setSelectionRange(2, 2)
        }
      })
    }
  }, [autoTrigger, hasGlyphs, value, onChange])

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
    setTimeout(() => {
      setAutocompleteFilter(null)
      // If the field is empty on blur, signal the wrapper to exit glyph mode
      if (onBlurEmpty && !inputRef.current?.value) {
        onBlurEmpty()
      }
    }, 150)
  }, [onBlurEmpty])

  const inputProps = {
    ref: inputRef,
    id,
    type: 'text' as const,
    value,
    onChange: handleChange,
    onKeyUp: handleKeyUp,
    onBlur: handleBlur,
    placeholder,
    disabled,
    spellCheck: hasGlyphs ? false : undefined,
    autoComplete: 'off' as const,
    className,
  }

  const autocompleteDropdown = autocompleteFilter !== null && (
    <div className="absolute top-full right-0 left-0 z-50 mt-1">
      <GlyphAutocomplete
        glyphs={glyphs}
        filter={autocompleteFilter}
        onSelect={handleSelect}
        onClose={handleClose}
      />
    </div>
  )

  // When grouped (inside InputGroup), only render the input inline.
  // The autocomplete and resolved preview are rendered outside via the wrapper.
  if (grouped) {
    return (
      <>
        <InputGroupInput {...inputProps} />
        {autocompleteDropdown}
      </>
    )
  }

  return (
    <div className="relative">
      <Input {...inputProps} />
      {autocompleteDropdown}
    </div>
  )
}
