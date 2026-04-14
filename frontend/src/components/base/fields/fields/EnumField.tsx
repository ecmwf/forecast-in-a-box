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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface EnumFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  options: Array<string>
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function EnumField({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  disabled,
  className,
}: EnumFieldProps) {
  return (
    <GlyphFieldWrapper
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    >
      <Select
        value={value || null}
        onValueChange={(newValue) => onChange(newValue ?? '')}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          data-slot="input-group-control"
          className="flex-1 border-0 shadow-none ring-0 focus-visible:ring-0"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlyphFieldWrapper>
  )
}
