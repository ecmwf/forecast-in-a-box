/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { AlertCircle } from 'lucide-react'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
} from '@/api/types/fable.types'
import {
  useBlockValidation,
  useFableBuilderStore,
} from '@/features/fable-builder/stores/fableBuilderStore'
import { P } from '@/components/base/typography'
import { getFactory } from '@/api/types/fable.types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ConfigSummaryCardProps {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
}

export function ConfigSummaryCard({
  instanceId,
  catalogue,
}: ConfigSummaryCardProps) {
  const fable = useFableBuilderStore((state) => state.fable)
  const blockValidation = useBlockValidation(instanceId)

  const instance = fable.blocks[instanceId]
  const factory = getFactory(catalogue, instance.factory_id)

  if (!factory) {
    return null
  }

  const hasErrors = blockValidation?.hasErrors ?? false
  const errors = blockValidation?.errors ?? []

  const configuredValues = Object.entries(instance.configuration_values).filter(
    ([_, value]) => value && value.trim() !== '',
  )

  const connectedInputs = Object.entries(instance.input_ids)
    .filter(([_, sourceId]) => sourceId && sourceId in fable.blocks)
    .map(([inputName, sourceId]) => {
      const sourceBlock = fable.blocks[sourceId]
      const sourceFactory = getFactory(catalogue, sourceBlock.factory_id)
      return { inputName, sourceTitle: sourceFactory?.title ?? 'Unknown' }
    })

  return (
    <div
      className={cn(
        'rounded-md border bg-card p-3',
        hasErrors && 'border-destructive',
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{factory.title}</span>
        {hasErrors && (
          <Badge variant="destructive" className="gap-1 text-sm">
            <AlertCircle className="h-3 w-3" />
            {errors.length}
          </Badge>
        )}
      </div>

      {hasErrors && (
        <div className="mb-2 rounded bg-destructive/10 p-2 text-sm text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {configuredValues.length > 0 && (
        <div className="space-y-1">
          {configuredValues.map(([key, value]) => {
            const option = factory.configuration_options[key]
            return (
              <div
                key={key}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {option.title || key}:
                </span>
                <span className="font-mono text-sm">{value}</span>
              </div>
            )
          })}
        </div>
      )}

      {connectedInputs.length > 0 && (
        <div className="mt-2 space-y-1 border-t pt-2">
          {connectedInputs.map(({ inputName, sourceTitle }) => (
            <div
              key={inputName}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">{inputName}:</span>
              <Badge variant="outline" className="text-sm">
                {sourceTitle}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {configuredValues.length === 0 &&
        connectedInputs.length === 0 &&
        !hasErrors && (
          <P className="text-muted-foreground">Default configuration</P>
        )}
    </div>
  )
}
