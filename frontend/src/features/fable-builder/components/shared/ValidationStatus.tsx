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
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ValidationStatusProps {
  compact?: boolean
  className?: string
}

export function ValidationStatusBadge({ className }: { className?: string }) {
  const validationState = useFableBuilderStore((state) => state.validationState)
  const isValidating = useFableBuilderStore((state) => state.isValidating)

  if (isValidating) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Validating
      </Badge>
    )
  }

  if (!validationState) {
    return null
  }

  const hasGlobalErrors = validationState.globalErrors.length > 0
  const hasBlockErrors = Object.values(validationState.blockStates).some(
    (state) => state.hasErrors,
  )

  if (!hasGlobalErrors && !hasBlockErrors) {
    return (
      <Badge
        variant="outline"
        className={cn('gap-1 border-green-200 text-green-600', className)}
      >
        <CheckCircle2 className="h-3 w-3" />
        Valid
      </Badge>
    )
  }

  return (
    <Badge variant="destructive" className={cn('gap-1', className)}>
      <AlertCircle className="h-3 w-3" />
      Has errors
    </Badge>
  )
}

export function ValidationStatus({
  compact = false,
  className,
}: ValidationStatusProps) {
  const validationState = useFableBuilderStore((state) => state.validationState)
  const isValidating = useFableBuilderStore((state) => state.isValidating)

  const errorSummary = useMemo(() => {
    if (!validationState) return null

    const globalErrors = validationState.globalErrors
    const blocksWithErrors = Object.entries(validationState.blockStates).filter(
      ([, state]) => state.hasErrors && state.errors.length > 0,
    )

    return {
      globalErrors,
      blocksWithErrors,
      isValid: globalErrors.length === 0 && blocksWithErrors.length === 0,
    }
  }, [validationState])

  if (isValidating) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 text-muted-foreground',
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Validating configuration...</span>
      </div>
    )
  }

  if (!errorSummary || errorSummary.isValid) {
    return null
  }

  if (errorSummary.globalErrors.length === 0) {
    if (compact) {
      return (
        <div className={cn('text-sm text-destructive', className)}>
          Has errors
        </div>
      )
    }
    return null
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Configuration Issues</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {errorSummary.globalErrors.map((error, index) => (
            <li key={index} className="text-sm">
              {error}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
