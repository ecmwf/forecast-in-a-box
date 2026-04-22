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
 * Provides ${…} autocomplete for variable names, callable helper globals
 * (e.g. `timedelta(...)`) and pipe-style helper filters (e.g.
 * `${dt | add_days}`). The current candidate set is decided by
 * `parseGlyphContext`, which classifies the cursor as `value`, `filter`, or
 * `none` based on the surrounding `${...}` syntax.
 *
 * When `grouped` is true, renders an InputGroupInput (for use inside an
 * InputGroup) instead of a standalone Input.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlyphContext } from '@/features/fable-builder/utils/glyph-expression-context'
import type { AutocompleteCandidate } from '@/features/fable-builder/components/shared/GlyphAutocomplete'
import { Input } from '@/components/ui/input'
import { InputGroupInput } from '@/components/ui/input-group'
import { useGlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { useGlyphFunctions } from '@/api/hooks/useFable'
import { GlyphAutocomplete } from '@/features/fable-builder/components/shared/GlyphAutocomplete'
import { buildAutocompleteInsertion } from '@/features/fable-builder/utils/build-autocomplete-insertion'
import { parseGlyphContext } from '@/features/fable-builder/utils/glyph-expression-context'

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
  const variables = useGlyphContext()
  const { data: helperFunctionsResponse } = useGlyphFunctions()
  const helperFunctions = helperFunctionsResponse?.functions ?? []

  const inputRef = useRef<HTMLInputElement>(null)
  const [context, setContext] = useState<GlyphContext | null>(null)

  const hasAnyCandidates = variables.length > 0 || helperFunctions.length > 0

  // Auto-insert ${ and open autocomplete when entering glyph mode on an empty field
  const didAutoTrigger = useRef(false)
  useEffect(() => {
    if (autoTrigger && hasAnyCandidates && !value && !didAutoTrigger.current) {
      didAutoTrigger.current = true
      onChange('${')
      setContext(parseGlyphContext('${', 2))
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          input.setSelectionRange(2, 2)
        }
      })
    }
  }, [autoTrigger, hasAnyCandidates, value, onChange])

  const recomputeContext = useCallback(
    (text: string, pos: number) => {
      if (!hasAnyCandidates) {
        setContext(null)
        return
      }
      const next = parseGlyphContext(text, pos)
      setContext(next.kind === 'none' ? null : next)
    },
    [hasAnyCandidates],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      const pos = e.target.selectionStart ?? newValue.length
      onChange(newValue)
      recomputeContext(newValue, pos)
    },
    [onChange, recomputeContext],
  )

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const pos = e.currentTarget.selectionStart ?? value.length
      recomputeContext(value, pos)
    },
    [value, recomputeContext],
  )

  // Build the candidate set for the current context kind. Variables and
  // helper-globals share the `value` slot; helper-filters fill the `filter`
  // slot. Computed from the raw lists (not from `filter`) — `GlyphAutocomplete`
  // does the prefix-matching itself.
  const candidates = useMemo<Array<AutocompleteCandidate>>(() => {
    if (!context) return []
    if (context.kind === 'value') {
      const fromVariables: Array<AutocompleteCandidate> = variables.map(
        (g) => ({
          name: g.name,
          displayName: g.displayName,
          meta: g.type === 'intrinsic' ? g.displayName : g.valueExample,
          source: g.type, // 'local' | 'global' | 'intrinsic'
        }),
      )
      const fromGlobals: Array<AutocompleteCandidate> = helperFunctions
        .filter((f) => f.kind === 'global')
        .map((f) => ({
          name: f.name,
          displayName: f.name,
          meta: f.description,
          source: 'helperGlobal' as const,
        }))
      return [...fromVariables, ...fromGlobals]
    }
    // context.kind === 'filter'
    return helperFunctions
      .filter((f) => f.kind === 'filter')
      .map((f) => ({
        name: f.name,
        displayName: f.name,
        meta: f.description,
        source: 'filter' as const,
      }))
  }, [context, variables, helperFunctions])

  const handleSelect = useCallback(
    (candidate: AutocompleteCandidate) => {
      if (!context) return
      const { replaceStart, replaceEnd } = context
      const insertion = buildAutocompleteInsertion(
        {
          name: candidate.name,
          source: candidate.source,
          description: candidate.meta,
        },
        value.slice(replaceEnd),
      )
      const newValue =
        value.slice(0, replaceStart) + insertion.text + value.slice(replaceEnd)
      onChange(newValue)
      setContext(null)

      requestAnimationFrame(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          const newCursor = replaceStart + insertion.cursorOffset
          input.setSelectionRange(newCursor, newCursor)
        }
      })
    },
    [context, value, onChange],
  )

  const handleClose = useCallback(() => {
    setContext(null)
  }, [])

  const handleBlur = useCallback(() => {
    // Delay close to allow mousedown on autocomplete items
    setTimeout(() => {
      setContext(null)
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
    spellCheck: hasAnyCandidates ? false : undefined,
    autoComplete: 'off' as const,
    className,
  }

  const autocompleteDropdown = context !== null && (
    <div className="absolute top-full right-0 left-0 z-50 mt-1">
      <GlyphAutocomplete
        candidates={candidates}
        filter={context.prefix}
        contextKind={context.kind === 'filter' ? 'filter' : 'value'}
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
