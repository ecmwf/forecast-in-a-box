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
import { AlertCircle } from 'lucide-react'
import { DateTimeField } from './fields/DateTimeField'
import { EnumField } from './fields/EnumField'
import { EnumListField } from './fields/EnumListField'
import { ListField } from './fields/ListField'
import { NumberField } from './fields/NumberField'
import { StringField } from './fields/StringField'
import { parseValueType } from './value-type-parser'
import type { ParsedValueType } from './value-type-parser'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  const { t } = useTranslation('common')
  const parsedType = useMemo(() => parseValueType(valueType), [valueType])

  const inputElement =
    parsedType.type === 'unresolvedCatalogue' ? (
      <div className="space-y-1">
        <StringField
          id={id}
          configKey={configKey}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={inputClassName}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <p className="flex cursor-default items-center gap-1 text-xs text-amber-600 dark:text-amber-400" />
            }
          >
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{t('field.unresolvedCatalogueLabel')}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-80 break-all">
            {t('field.unresolvedCatalogueHint')}
            <br />
            <span className="mt-1 block font-mono text-xs opacity-70">
              {parsedType.raw}
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
    ) : (
      renderField(
        parsedType,
        id,
        configKey,
        value,
        onChange,
        placeholder,
        disabled,
        inputClassName,
      )
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

    case 'unresolvedCatalogue':
      // Handled in the FieldRenderer body (needs the i18n `t` function in
      // scope); this branch should never be reached from the inline switch.
      return null

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
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )
  }
}
