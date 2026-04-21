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

export interface StringFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * String config field — uses GlyphFieldWrapper for consistent visual treatment.
 * In concrete mode: plain text input. In glyph mode: text input with autocomplete.
 */
export function StringField({
  id,
  configKey,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: StringFieldProps) {
  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    >
      <InputGroupInput
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </GlyphFieldWrapper>
  )
}
