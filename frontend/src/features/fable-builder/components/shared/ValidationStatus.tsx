/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function ValidationStatusBadge({ className }: { className?: string }) {
  const { t } = useTranslation('configure')
  const validationState = useFableBuilderStore((state) => state.validationState)
  const isValidating = useFableBuilderStore((state) => state.isValidating)

  if (isValidating) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('validationStatus.validating')}
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
        {t('validationStatus.valid')}
      </Badge>
    )
  }

  return (
    <Badge variant="destructive" className={cn('gap-1', className)}>
      <AlertCircle className="h-3 w-3" />
      {t('validationStatus.hasErrors')}
    </Badge>
  )
}
