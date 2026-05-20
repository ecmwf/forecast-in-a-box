/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { useFieldErrors } from '@/features/fable-builder/context/BlockValidationContext'

export interface MultiSelectFieldProps {
  id: string
  configKey: string
  /** Wire value: comma-separated list of items, matching `list[str]` encoding. */
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<string>
  /**
   * `true` (the `list[enumClosed[…]]` case) restricts selections to `options`.
   * `false` (the `list[enum[…]]` case) would let users add free-form values —
   * not implemented yet, kept in the prop shape for forward compatibility.
   */
  closed?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

function parseListValue(raw: string): Array<string> {
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function serializeListValue(items: ReadonlyArray<string>): string {
  return items.join(',')
}

export function MultiSelectField({
  id,
  configKey,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: MultiSelectFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.addItemPlaceholder')
  const items = parseListValue(value)
  const anchor = useComboboxAnchor()
  // Drop persisted values not in the current `options`. Storage keeps the
  // original until the next user edit (we don't fire onChange on render).
  const validItems = items.filter((v) => options.includes(v))

  // Glyph mode is intentionally disabled — a multi-select doesn't have a
  // meaningful free-form glyph substitution. Errors come from
  // BlockValidationContext and we render the inline ring + message here
  // instead of going through GlyphFieldWrapper (whose InputGroup chrome
  // visually fights the Combobox's own bordered chip container).
  const fieldErrors = useFieldErrors()?.[configKey] ?? null
  const hasFieldError = fieldErrors !== null && fieldErrors.length > 0
  const errorMessage = hasFieldError
    ? fieldErrors.length > 1
      ? `${fieldErrors[0]} (+${fieldErrors.length - 1} more)`
      : fieldErrors[0]
    : null

  return (
    <div>
      <Combobox<string, true>
        multiple
        autoHighlight
        items={[...options]}
        value={validItems}
        onValueChange={(next) => onChange(serializeListValue(next))}
        disabled={disabled}
      >
        <ComboboxChips
          ref={anchor}
          className={hasFieldError ? 'border-destructive' : undefined}
        >
          <ComboboxValue>
            {(values: Array<string>) => (
              <>
                {values.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={id}
                  placeholder={
                    values.length === 0 ? resolvedPlaceholder : undefined
                  }
                  disabled={disabled}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>{t('field.noMatches')}</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {errorMessage && (
        <p className="mt-1 truncate text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  )
}
