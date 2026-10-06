/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ParamHintTooltip,
  ParamOptionLabel,
  matchesParam,
} from './ParamOptionLabel'
import type { DisplayLookup } from '@/components/base/fields/value-type-parser'
import { paramLabel } from '@/components/base/fields/param-display'
import { useParamLabels } from '@/api/hooks/useFable'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Reveal } from '@/components/common/Reveal'
import { useFieldErrors } from '@/features/fable-builder/context/BlockValidationContext'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'

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
  /** Label options and chips via a backend lookup instead of raw ids. */
  lookup?: DisplayLookup
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
  closed = true,
  lookup,
  placeholder,
  disabled,
}: EnumListFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.addItemPlaceholder')
  const items = parseListValue(value)
  const anchor = useComboboxAnchor()
  // Stale: closed options no longer offer it (glyphs resolve server-side).
  const isStale = (v: string) =>
    closed && !options.includes(v) && !containsGlyphs(v)
  const labelIds = useMemo(
    () =>
      lookup === 'param'
        ? [...new Set([...options, ...parseListValue(value)])]
        : [],
    [lookup, options, value],
  )
  const labels = useParamLabels(labelIds)
  const labelled = labels.size > 0

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
    <TooltipProvider delay={120}>
      <div>
        <Combobox<string, true>
          multiple
          autoHighlight
          items={[...options]}
          value={items}
          onValueChange={(next) => onChange(serializeListValue(next))}
          itemToStringLabel={
            labelled ? (v: string) => paramLabel(v, labels, 'full') : undefined
          }
          filter={
            labelled
              ? (item: string, query: string) =>
                  matchesParam(item, query, labels)
              : undefined
          }
          disabled={disabled}
        >
          <ComboboxChips
            ref={anchor}
            className={hasFieldError ? 'border-destructive' : undefined}
          >
            <ComboboxValue>
              {(values: Array<string>) => (
                <>
                  {values.map((v) =>
                    isStale(v) ? (
                      <Tooltip key={v}>
                        <TooltipTrigger
                          render={
                            <ComboboxChip className="bg-destructive/10 text-danger">
                              {v}
                            </ComboboxChip>
                          }
                        />
                        <TooltipContent side="top" sideOffset={6}>
                          {t('field.staleValue', { value: v })}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <ParamHintTooltip key={v} id={v} labels={labels}>
                        <ComboboxChip>
                          {paramLabel(v, labels, 'compact')}
                        </ComboboxChip>
                      </ParamHintTooltip>
                    ),
                  )}
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
                  {labelled ? (
                    <ParamOptionLabel id={item} labels={labels} />
                  ) : (
                    item
                  )}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <Reveal open={errorMessage !== null}>
          <p className="truncate pt-1 text-xs text-danger">{errorMessage}</p>
        </Reveal>
      </div>
    </TooltipProvider>
  )
}
