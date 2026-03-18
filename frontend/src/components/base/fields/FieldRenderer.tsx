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
import { DateTimeField } from './fields/DateTimeField'
import { EnumField } from './fields/EnumField'
import { ListField } from './fields/ListField'
import { NumberField } from './fields/NumberField'
import { StringField } from './fields/StringField'
import { parseValueType } from './value-type-parser'
import type { ParsedValueType } from './value-type-parser'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface FieldRendererProps {
  id: string
  valueType: string | undefined
  value: string
  onChange: (value: string) => void
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  inputClassName?: string
}

export function FieldRenderer({
  id,
  valueType,
  value,
  onChange,
  label,
  description,
  placeholder,
  disabled,
  className,
  inputClassName,
}: FieldRendererProps) {
  const parsedType = useMemo(() => parseValueType(valueType), [valueType])

  const inputElement = renderField(
    parsedType,
    id,
    value,
    onChange,
    placeholder,
    disabled,
    inputClassName,
  )

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
      )}
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {inputElement}
    </div>
  )
}

function renderField(
  parsedType: ParsedValueType,
  id: string,
  value: string,
  onChange: (value: string) => void,
  placeholder?: string,
  disabled?: boolean,
  className?: string,
): React.ReactNode {
  switch (parsedType.type) {
    case 'string':
    case 'unknown':
      return (
        <StringField
          id={id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'int':
      return (
        <NumberField
          id={id}
          value={value}
          onChange={onChange}
          isInteger={true}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'float':
      return (
        <NumberField
          id={id}
          value={value}
          onChange={onChange}
          isInteger={false}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'datetime':
      return (
        <DateTimeField
          id={id}
          value={value}
          onChange={onChange}
          isDateOnly={false}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'date':
      return (
        <DateTimeField
          id={id}
          value={value}
          onChange={onChange}
          isDateOnly={true}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'enum':
      return (
        <EnumField
          id={id}
          value={value}
          onChange={onChange}
          options={parsedType.options}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'list':
      return (
        <ListField
          id={id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )
  }
}

/**
 * Lightweight version without label/description for inline use
 */
export interface InlineFieldRendererProps {
  id: string
  valueType: string | undefined
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function InlineFieldRenderer({
  id,
  valueType,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: InlineFieldRendererProps) {
  const parsedType = useMemo(() => parseValueType(valueType), [valueType])

  return renderField(
    parsedType,
    id,
    value,
    onChange,
    placeholder,
    disabled,
    className,
  )
}
