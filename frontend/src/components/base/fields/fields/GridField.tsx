/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import {
  AUTO_GRID,
  LARGE_GRID_POINTS,
  MAX_GAUSSIAN_NUMBER,
  MIN_GAUSSIAN_NUMBER,
  MIN_GRID_RESOLUTION,
  canonicalGrid,
  gridPoints,
  gridSpacingKm,
  groupGridOptions,
  isSameGrid,
  parseGrid,
} from './grid'
import type { TFunction } from 'i18next'
import type { GridError, GridGroup, GridGroupKey, GridSpec } from './grid'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { InputGroupAddon } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

export interface GridFieldProps {
  id: string
  configKey: string
  /** Grid wire string, e.g. `auto`, `0.25`, `0.25/0.5`, `O96`. */
  value: string
  onChange: (value: string) => void
  /** Suggested grids as wire strings. */
  options: ReadonlyArray<string>
  /** `enumClosed[grid]`: the suggestions only, no free entry. */
  closed?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

const GROUP_LABEL_KEY = {
  custom: 'grid.groupCustom',
  latlon: 'grid.groupLatlon',
  octahedral: 'grid.groupOctahedral',
  reduced: 'grid.groupReduced',
} as const satisfies Record<Exclude<GridGroupKey, 'keep'>, string>

/** Grouped grid picker with a validated free entry. */
export function GridField({
  id,
  configKey,
  value,
  onChange,
  options,
  closed = false,
  placeholder,
  disabled,
  className,
}: GridFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('grid.placeholder')
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const typed = closed || !trimmed ? null : canonicalGrid(trimmed)
  const groups = useMemo(
    () => groupGridOptions(options, value, typed),
    [options, value, typed],
  )
  const queryResult = trimmed ? parseGrid(trimmed) : null
  const queryError =
    !closed && queryResult && !queryResult.ok ? queryResult.error : null

  const current = parseGrid(value)
  const spacing = current.ok ? gridSpacingLabel(t, current.spec) : null

  const matches = (item: string, search: string): boolean => {
    if (typed !== null && isSameGrid(item, typed)) return true
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return `${item} ${gridName(t, item)}`.toLowerCase().includes(needle)
  }

  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      disabled={disabled}
      className={className}
      selfContainedChild
    >
      <Combobox<string>
        autoHighlight
        items={groups}
        value={value || null}
        onValueChange={(next) => {
          if (next !== null) onChange(canonicalGrid(next) ?? next)
        }}
        isItemEqualToValue={isSameGrid}
        itemToStringLabel={(item) => gridName(t, item)}
        filter={matches}
        onInputValueChange={setQuery}
        onOpenChange={(open) => {
          if (!open) setQuery('')
        }}
        disabled={disabled}
      >
        <ComboboxTrigger
          id={id}
          render={
            <Button
              variant="outline"
              className={cn(
                'h-9 w-full min-w-0 shrink justify-between gap-2 font-normal',
                // The glyph wrapper's group draws the border.
                'in-data-[slot=input-group]:border-0 in-data-[slot=input-group]:bg-transparent in-data-[slot=input-group]:shadow-none',
                className,
              )}
            />
          }
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            {value ? (
              gridSummary(t, value)
            ) : (
              <span className="text-muted-foreground">
                {resolvedPlaceholder}
              </span>
            )}
          </span>
          {spacing && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {spacing}
            </span>
          )}
        </ComboboxTrigger>
        <ComboboxContent className="min-w-(--anchor-width)">
          <ComboboxInput
            showTrigger={false}
            placeholder={t('grid.search')}
            className="rounded-lg! has-[[data-slot=input-group-control]:focus-visible]:border-input/30 has-[[data-slot=input-group-control]:focus-visible]:ring-0 *:data-[slot=input-group-addon]:pl-1.5!"
          >
            <InputGroupAddon>
              <SearchIcon className="size-4 shrink-0 opacity-50" />
            </InputGroupAddon>
          </ComboboxInput>
          <ComboboxEmpty className="px-3 text-left">
            {queryError
              ? gridErrorMessage(t, queryError)
              : t('field.noMatches')}
          </ComboboxEmpty>
          <ComboboxList>
            {(group: GridGroup) => (
              <ComboboxGroup key={group.value} items={group.items}>
                {group.value !== 'keep' && (
                  <ComboboxLabel>
                    {t(GROUP_LABEL_KEY[group.value])}
                  </ComboboxLabel>
                )}
                <ComboboxCollection>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      <GridRow item={item} />
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </GlyphFieldWrapper>
  )
}

function GridRow({ item }: { item: string }) {
  const { t, i18n } = useTranslation('common')
  const compact = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        notation: 'compact',
        maximumSignificantDigits: 2,
      }),
    [i18n.language],
  )
  const parsed = parseGrid(item)
  if (!parsed.ok) return <span className="truncate">{item}</span>
  if (parsed.spec.kind === 'auto') {
    return (
      <>
        <span className="truncate">{t('grid.keep')}</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {AUTO_GRID}
        </span>
      </>
    )
  }
  const points = gridPoints(parsed.spec)
  return (
    <>
      <span className="w-14 shrink-0 truncate tabular-nums">
        {gridName(t, item)}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {gridSpacingLabel(t, parsed.spec)}
      </span>
      {points && (
        <span
          className={cn(
            'ml-auto pl-2 text-xs whitespace-nowrap tabular-nums',
            // `!` beats the highlighted item's descendant recolour.
            points.count > LARGE_GRID_POINTS
              ? 'text-warning!'
              : 'text-muted-foreground',
          )}
        >
          {t(points.approx ? 'grid.pointsApprox' : 'grid.points', {
            count: compact.format(points.count),
          })}
        </span>
      )}
    </>
  )
}

/** Short grid name, e.g. O96; unparsable values as given. */
function gridName(t: TFunction<'common'>, value: string): string {
  const parsed = parseGrid(value)
  if (!parsed.ok) return value
  const spec = parsed.spec
  switch (spec.kind) {
    case 'auto':
      return t('grid.keep')
    case 'gaussian':
      return `${spec.family}${spec.number}`
    case 'latlon':
      return spec.pair
        ? t('grid.pair', { dx: spec.dx, dy: spec.dy })
        : t('grid.degrees', { value: spec.dx })
  }
}

/** The short name, with "lat/lon" after a resolution. */
function gridSummary(t: TFunction<'common'>, value: string): string {
  const parsed = parseGrid(value)
  if (parsed.ok && parsed.spec.kind === 'latlon') {
    return t('grid.latlon', { resolution: gridName(t, value) })
  }
  return gridName(t, value)
}

function gridSpacingLabel(
  t: TFunction<'common'>,
  spec: GridSpec,
): string | null {
  const km = gridSpacingKm(spec)
  return km === null ? null : t('grid.spacing', { km })
}

function gridErrorMessage(t: TFunction<'common'>, error: GridError): string {
  switch (error.code) {
    case 'notGrid':
      return t('grid.error.notGrid')
    case 'tooManyParts':
      return t('grid.error.tooManyParts')
    case 'notPositive':
      return t('grid.error.notPositive', { resolution: error.resolution })
    case 'tooFine':
      return t('grid.error.tooFine', {
        resolution: error.resolution,
        min: MIN_GRID_RESOLUTION,
      })
    case 'gaussianRange':
      return t('grid.error.gaussianRange', {
        min: MIN_GAUSSIAN_NUMBER,
        max: MAX_GAUSSIAN_NUMBER,
      })
    case 'leadingZeros':
      return t('grid.error.leadingZeros')
  }
}
