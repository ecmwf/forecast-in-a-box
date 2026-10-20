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
import { DimOptionsPopup } from './DimOptionsPopup'
import { Button } from '@/components/ui/button'
import { Combobox, ComboboxTrigger } from '@/components/ui/combobox'

interface DimFilterMenuProps {
  /** Dimension name, e.g. "Parameter". */
  name: string
  values: ReadonlyArray<string>
  /** Selected values; empty = all. */
  selected: ReadonlyArray<string>
  shortLabel: (value: string) => string
  fullLabel: (value: string) => string
  onChange: (next: ReadonlyArray<string>) => void
}

/** Values named in the trigger before it shows a count. */
const NAMED_MAX = 2

/** Searchable multi-select over one split coordinate. */
export function DimFilterMenu({
  name,
  values,
  selected,
  shortLabel,
  fullLabel,
  onChange,
}: DimFilterMenuProps) {
  const { t } = useTranslation('executions')
  const summary =
    selected.length === 0
      ? t('outputs.dims.all', { dim: name })
      : selected.length <= NAMED_MAX
        ? t('outputs.dims.some', {
            dim: name,
            values: selected.map(shortLabel).join(', '),
          })
        : t('outputs.dims.count', {
            dim: name,
            count: selected.length,
            total: values.length,
          })

  return (
    <Combobox<string, true>
      multiple
      autoHighlight
      items={[...values]}
      value={[...selected]}
      onValueChange={onChange}
      itemToStringLabel={fullLabel}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="w-44 justify-between font-normal"
          />
        }
      >
        <span className="truncate">{summary}</span>
      </ComboboxTrigger>
      <DimOptionsPopup
        label={fullLabel}
        footer={
          selected.length > 0 && (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
                onClick={() => onChange([])}
              >
                {t('outputs.dims.showAll')}
              </Button>
            </div>
          )
        }
      />
    </Combobox>
  )
}
