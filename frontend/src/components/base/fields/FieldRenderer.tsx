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
import { ArtifactField } from './fields/ArtifactField'
import { DateTimeField } from './fields/DateTimeField'
import { EnumField } from './fields/EnumField'
import { EnumListField } from './fields/EnumListField'
import { GeoDomainField } from './fields/GeoDomainField'
import { GridField } from './fields/GridField'
import { ListField } from './fields/ListField'
import { NumberField } from './fields/NumberField'
import { StringField } from './fields/StringField'
import { parseValueType } from './value-type-parser'
import type { ParsedValueType } from './value-type-parser'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface FieldRendererProps {
  id: string
  /** Configuration key for this field, used to look up server-resolved glyph values */
  configKey: string
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
  configKey,
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
    configKey,
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
      {description && <FieldDescription text={description} />}
      {inputElement}
    </div>
  )
}

/** Plain text; consecutive `- ` lines render as a bullet list. */
function FieldDescription({ text }: { text: string }) {
  const blocks: Array<string | Array<string>> = []
  for (const line of text.split('\n')) {
    const item = /^\s*- (.*)$/.exec(line)?.[1]
    const last = blocks.at(-1)
    if (item === undefined) {
      if (line.trim()) blocks.push(line)
    } else if (Array.isArray(last)) last.push(item)
    else blocks.push([item])
  }
  return (
    <div className="space-y-0.5 text-sm text-muted-foreground">
      {blocks.map((block, i) =>
        Array.isArray(block) ? (
          <ul key={i} className="list-disc space-y-0.5 pl-4">
            {block.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{block}</p>
        ),
      )}
    </div>
  )
}

function renderField(
  parsedType: ParsedValueType,
  id: string,
  configKey: string,
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
          configKey={configKey}
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
          configKey={configKey}
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
          configKey={configKey}
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
          configKey={configKey}
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
          configKey={configKey}
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
          configKey={configKey}
          value={value}
          onChange={onChange}
          options={parsedType.options}
          lookup={parsedType.lookup}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'list':
      return (
        <ListField
          id={id}
          configKey={configKey}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
          itemType={parsedType.itemType}
          lookup={'lookup' in parsedType ? parsedType.lookup : undefined}
        />
      )

    case 'enumList':
      return (
        <EnumListField
          id={id}
          configKey={configKey}
          value={value}
          onChange={onChange}
          options={parsedType.options}
          closed={parsedType.closed}
          lookup={parsedType.lookup}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'geodomain':
      return (
        <GeoDomainField
          id={id}
          configKey={configKey}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'grid':
      return (
        <GridField
          id={id}
          configKey={configKey}
          value={value}
          onChange={onChange}
          options={parsedType.options}
          closed={parsedType.closed}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )

    case 'artifact':
      return (
        <ArtifactField
          id={id}
          configKey={configKey}
          value={value}
          onChange={onChange}
          options={parsedType.options}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )
  }
}
