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
import type { FableBuilderV1 } from '@/api/types/fable.types'
import {
  buildNestedDynExpr,
  findFieldPaths,
  flattenDynExpr,
} from '@/features/schedules/utils/dynamic-fields'
import { Label } from '@/components/ui/label'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

const EXECUTION_TIME_EXPR = '$execution_time'

interface DiscoveredField {
  fieldName: string
  fieldValue: string
  paths: Array<Array<string>>
}

interface DynamicFieldsSelectorProps {
  compiledExecSpec: object
  fable: FableBuilderV1
  value: Record<string, unknown>
  onChange: (expr: Record<string, unknown>) => void
}

export function DynamicFieldsSelector({
  compiledExecSpec,
  fable,
  value,
  onChange,
}: DynamicFieldsSelectorProps) {
  const { t } = useTranslation('executions')

  // Discover all configuration_values from fable blocks and find their paths in the compiled spec
  const discoveredFields = useMemo(() => {
    const fields: Array<DiscoveredField> = []
    const seenValues = new Set<string>()

    for (const block of Object.values(fable.blocks)) {
      for (const [fieldName, fieldValue] of Object.entries(
        block.configuration_values,
      )) {
        if (seenValues.has(fieldValue)) continue
        seenValues.add(fieldValue)

        const paths = findFieldPaths(compiledExecSpec, fieldValue)
        if (paths.length > 0) {
          fields.push({ fieldName, fieldValue, paths })
        }
      }
    }

    return fields
  }, [compiledExecSpec, fable])

  // Check which fields are currently toggled on
  const activeEntries = flattenDynExpr(value)
  const activePaths = new Set(activeEntries.map((e) => e.path.join('.')))

  function isFieldActive(field: DiscoveredField): boolean {
    return field.paths.some((p) => activePaths.has(p.join('.')))
  }

  function handleToggle(field: DiscoveredField) {
    if (isFieldActive(field)) {
      // Remove these paths from the dynamic expr
      const remaining = activeEntries.filter(
        (e) => !field.paths.some((p) => p.join('.') === e.path.join('.')),
      )
      onChange(
        buildNestedDynExpr(
          remaining.map((e) => e.path),
          EXECUTION_TIME_EXPR,
        ),
      )
    } else {
      // Add these paths
      const allPaths = [...activeEntries.map((e) => e.path), ...field.paths]
      onChange(buildNestedDynExpr(allPaths, EXECUTION_TIME_EXPR))
    }
  }

  if (discoveredFields.length === 0) {
    return (
      <div className="space-y-2">
        <Label>{t('submit.dynamicFields')}</Label>
        <P className="text-sm text-muted-foreground">
          {t('submit.dynamicFieldsFallbackHelp')}
        </P>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Label>{t('submit.dynamicFields')}</Label>

      <div className="space-y-2">
        {discoveredFields.map((field) => {
          const active = isFieldActive(field)
          return (
            <button
              key={field.fieldName + field.fieldValue}
              type="button"
              onClick={() => handleToggle(field)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm transition-colors',
                active
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border hover:bg-muted/50',
              )}
            >
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30',
                )}
              >
                {active && (
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {field.fieldName}
                  <span className="ml-2 font-mono text-muted-foreground">
                    = {field.fieldValue}
                  </span>
                </div>
                {active && (
                  <P className="mt-0.5 text-sm text-muted-foreground">
                    {t('submit.dynamicFieldPreview')}
                  </P>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
