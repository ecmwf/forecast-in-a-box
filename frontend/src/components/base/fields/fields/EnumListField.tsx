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

export interface EnumListFieldProps {
  id: string
  configKey: string
  /** Comma-separated, matching the `list[str]` wire encoding. */
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<string>
  /** `list[enumClosed[…]]` (closed, default) vs `list[enum[…]]` (open;
   * free-form not wired yet, kept for forward compat). */
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

export function EnumListField({
  id,
  configKey,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: EnumListFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.addItemPlaceholder')
  const items = parseListValue(value)
  const anchor = useComboboxAnchor()
  // Hide persisted values no longer in `options`; storage keeps them until
  // the next edit (we don't fire onChange on render).
  const validItems = items.filter((v) => options.includes(v))

  // No GlyphFieldWrapper: glyph mode is meaningless for multi-select, and
  // its InputGroup chrome fights the Combobox's own chip container. Render
  // errors inline instead.
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
