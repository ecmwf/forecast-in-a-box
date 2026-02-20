/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Play } from 'lucide-react'
import { ConfigSummaryCard } from './ConfigSummaryCard'
import type { BlockFactoryCatalogue, BlockKind } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { SubmitJobDialog } from '@/features/executions/components/SubmitJobDialog'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  getBlockKindIcon,
  getFactory,
} from '@/api/types/fable.types'
import { cn } from '@/lib/utils'

interface ReviewStepProps {
  catalogue: BlockFactoryCatalogue
}

export function ReviewStep({ catalogue }: ReviewStepProps) {
  const fable = useFableBuilderStore((state) => state.fable)
  const fableName = useFableBuilderStore((state) => state.fableName)
  const fableId = useFableBuilderStore((state) => state.fableId)
  const validationState = useFableBuilderStore((state) => state.validationState)
  const isValidating = useFableBuilderStore((state) => state.isValidating)
  const setStep = useFableBuilderStore((state) => state.setStep)

  const [submitDialogOpen, setSubmitDialogOpen] = useState(false)

  const blocksByKind = useMemo(() => {
    const groups: Record<
      BlockKind,
      Array<{ id: string; factoryTitle: string }>
    > = {
      source: [],
      transform: [],
      product: [],
      sink: [],
    }

    for (const [id, instance] of Object.entries(fable.blocks)) {
      const factory = getFactory(catalogue, instance.factory_id)
      if (factory) {
        groups[factory.kind].push({ id, factoryTitle: factory.title })
      }
    }

    return groups
  }, [fable.blocks, catalogue])

  const validationSummary = useMemo(() => {
    if (!validationState) return null

    const globalErrors = validationState.globalErrors
    let blockErrorCount = 0
    for (const state of Object.values(validationState.blockStates)) {
      if (state.hasErrors) {
        blockErrorCount += state.errors.length
      }
    }

    return {
      isValid: validationState.isValid,
      globalErrors,
      blockErrorCount,
      totalErrors: globalErrors.length + blockErrorCount,
    }
  }, [validationState])

  function handleSubmit(): void {
    setSubmitDialogOpen(true)
  }

  function handleBackToEdit(): void {
    setStep('edit')
  }

  const blockCount = Object.keys(fable.blocks).length
  const canSubmit = validationSummary?.isValid && !isValidating

  return (
    <div className="h-full flex-1 overflow-y-auto bg-muted/30">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <H2 className="text-2xl font-semibold">Review Configuration</H2>
          <P className="mt-1 text-muted-foreground">
            Review your forecast configuration before submitting.
          </P>
        </div>

        {isValidating ? (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Validating Configuration</AlertTitle>
            <AlertDescription>
              Please wait while we validate your configuration...
            </AlertDescription>
          </Alert>
        ) : validationSummary && !validationSummary.isValid ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Configuration Has Errors</AlertTitle>
            <AlertDescription>
              <P className="mb-2">
                Please fix the following issues before submitting:
              </P>
              {validationSummary.globalErrors.length > 0 && (
                <ul className="list-disc space-y-1 pl-4">
                  {validationSummary.globalErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
              {validationSummary.blockErrorCount > 0 && (
                <P className="mt-2">
                  {validationSummary.blockErrorCount} block-level{' '}
                  {validationSummary.blockErrorCount === 1 ? 'error' : 'errors'}{' '}
                  found.
                </P>
              )}
            </AlertDescription>
          </Alert>
        ) : validationSummary?.isValid ? (
          <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-600">Ready to Submit</AlertTitle>
            <AlertDescription className="text-green-600/80">
              Your configuration is valid and ready to be submitted.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Configuration Summary</CardTitle>
            <CardDescription>
              {blockCount} {blockCount === 1 ? 'block' : 'blocks'} configured
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {BLOCK_KIND_ORDER.map((kind) => {
              const blocks = blocksByKind[kind]
              if (blocks.length === 0) return null

              const metadata = BLOCK_KIND_METADATA[kind]
              const IconComponent = getBlockKindIcon(kind)

              return (
                <div key={kind}>
                  <div className="mb-3 flex items-center gap-2">
                    <div className={cn('rounded p-1.5', metadata.bgColor)}>
                      <IconComponent
                        className={cn('h-4 w-4', metadata.color)}
                      />
                    </div>
                    <span className="font-medium">{metadata.label}s</span>
                    <Badge variant="secondary">{blocks.length}</Badge>
                  </div>
                  <div className="ml-8 space-y-2">
                    {blocks.map(({ id }) => (
                      <ConfigSummaryCard
                        key={id}
                        instanceId={id}
                        catalogue={catalogue}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="outline" onClick={handleBackToEdit}>
            Back to Edit
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            Submit Job
          </Button>
        </div>

        <SubmitJobDialog
          open={submitDialogOpen}
          onOpenChange={setSubmitDialogOpen}
          fable={fable}
          fableName={fableName}
          fableId={fableId}
        />
      </div>
    </div>
  )
}
