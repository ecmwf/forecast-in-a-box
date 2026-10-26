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
import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import { ParamOptionLabel } from './ParamOptionLabel'
import type { DisplayLookup } from '@/components/base/fields/value-type-parser'
import { paramLabel } from '@/components/base/fields/param-display'
import { useParamLabels } from '@/api/hooks/useFable'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface EnumFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  options: Array<string>
  /** Label options via a backend lookup instead of showing raw ids. */
  lookup?: DisplayLookup
  placeholder?: string
  disabled?: boolean
  className?: string
}

const NO_OPTIONS: Array<string> = []

export function EnumField({
  id,
  configKey,
  value,
  onChange,
  options,
  lookup,
  placeholder,
  disabled,
  className,
}: EnumFieldProps) {
  const { t } = useTranslation('common')
  const resolvedPlaceholder = placeholder ?? t('field.selectPlaceholder')
  const labels = useParamLabels(lookup === 'param' ? options : NO_OPTIONS)
  const labelled = labels.size > 0
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
      <Select
        value={value || null}
        onValueChange={(newValue) => onChange(newValue ?? '')}
        itemToStringLabel={
          labelled ? (v: string) => paramLabel(v, labels, 'full') : undefined
        }
        disabled={disabled}
      >
        <SelectTrigger id={id} className={cn('w-full', className)}>
          <SelectValue placeholder={resolvedPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labelled ? (
                <ParamOptionLabel id={option} labels={labels} />
              ) : (
                option
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlyphFieldWrapper>
  )
}
