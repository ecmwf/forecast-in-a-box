/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import { InputGroupInput } from '@/components/ui/input-group'

export interface DateTimeFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  isDateOnly?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function DateTimeField({
  id,
  configKey,
  value,
  onChange,
  isDateOnly = false,
  placeholder,
  disabled,
  className,
}: DateTimeFieldProps) {
  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      isDateOnly={isDateOnly}
    >
      <InputGroupInput
        id={id}
        type={isDateOnly ? 'date' : 'datetime-local'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </GlyphFieldWrapper>
  )
}
