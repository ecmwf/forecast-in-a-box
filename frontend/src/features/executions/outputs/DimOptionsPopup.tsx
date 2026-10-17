/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { SearchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { InputGroupAddon } from '@/components/ui/input-group'

interface DimOptionsPopupProps {
  label: (value: string) => string
  onInputKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  footer?: ReactNode
}

/** Searchable one-line options of a coordinate. */
export function DimOptionsPopup({
  label,
  onInputKeyDown,
  footer,
}: DimOptionsPopupProps) {
  const { t } = useTranslation('executions')
  return (
    <ComboboxContent className="w-max max-w-[min(28rem,var(--available-width))] min-w-(--anchor-width)">
      <ComboboxInput
        showTrigger={false}
        placeholder={t('outputs.dims.search')}
        onKeyDown={onInputKeyDown}
        className="rounded-lg! has-[[data-slot=input-group-control]:focus-visible]:border-input/30 has-[[data-slot=input-group-control]:focus-visible]:ring-0 *:data-[slot=input-group-addon]:pl-1.5!"
      >
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </ComboboxInput>
      <ComboboxEmpty>{t('outputs.dims.noMatch')}</ComboboxEmpty>
      <ComboboxList>
        {(value: string) => (
          <ComboboxItem key={value} value={value}>
            <span className="truncate">{label(value)}</span>
          </ComboboxItem>
        )}
      </ComboboxList>
      {footer}
    </ComboboxContent>
  )
}
