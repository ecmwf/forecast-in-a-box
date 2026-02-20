/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import React, { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircle, Package } from 'lucide-react'
import { FableBuilderHeader } from './FableBuilderHeader'
import {
  BlockPalette,
  ConfigPanel,
  MobileLayout,
  ThreeColumnLayout,
} from './layout'
import { FableGraphCanvas } from './graph-mode'
import { FableFormCanvas } from './form-mode'
import { ReviewStep as ReviewStepComponent } from './review'
import type { PresetId } from '@/features/fable-builder/presets'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import type { FableMetadataStore } from '@/features/fable-builder/components/SaveConfigPopover'
import { useURLStateSync } from '@/features/fable-builder/hooks/useURLStateSync'
import { getPreset } from '@/features/fable-builder/presets'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useMedia } from '@/hooks/useMedia'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { toValidationState } from '@/api/types/fable.types'
import {
  useBlockCatalogue,
  useFable,
  useFableValidation,
} from '@/api/hooks/useFable'
import { H2, P } from '@/components/base/typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'
import { useUser } from '@/hooks/useUser'
import { ApiClientError } from '@/api/client'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/**
 * Extract a user-friendly error message from a validation error
 */
function getValidationErrorMessage(error: Error): string {
  // Check if it's an ApiClientError with details
  if (error instanceof ApiClientError) {
    const details = error.details
    if (details && typeof details === 'object') {
      // Try to extract validation details from the response
      const detailObj = details as Record<string, unknown>
      if (detailObj.detail) {
        // FastAPI validation error format
        if (Array.isArray(detailObj.detail)) {
          return detailObj.detail
            .map(
              (d: { msg?: string; loc?: Array<string> }) => d.msg ?? String(d),
            )
            .join('. ')
        }
        return String(detailObj.detail)
      }
    }
    // Fall back to status-based message
    if (error.status === 422) {
      return 'Invalid configuration. Please fill in all required fields.'
    }
  }
  return (
    error.message ||
    'Failed to validate configuration. Please check your block settings.'
  )
}

interface FableBuilderPageProps {
  fableId?: string
  preset?: PresetId
  encodedState?: string
}

export function FableBuilderPage({
  fableId,
  preset,
  encodedState,
}: FableBuilderPageProps) {
  const fable = useFableBuilderStore((state) => state.fable)
  const setFable = useFableBuilderStore((state) => state.setFable)
  const newFable = useFableBuilderStore((state) => state.newFable)
  const setFableName = useFableBuilderStore((state) => state.setFableName)
  const mode = useFableBuilderStore((state) => state.mode)
  const step = useFableBuilderStore((state) => state.step)
  const setValidationState = useFableBuilderStore(
    (state) => state.setValidationState,
  )
  const setIsValidating = useFableBuilderStore((state) => state.setIsValidating)

  const initializedRef = useRef(false)

  useURLStateSync({
    encodedState: fableId ? undefined : encodedState,
    enabled: !fableId,
  })

  const isDesktop = useMedia('(min-width: 768px)')

  const { data: catalogue, isLoading: catalogueLoading } = useBlockCatalogue()
  const {
    data: existingFable,
    isLoading: fableLoading,
    error: fableError,
  } = useFable(fableId ?? null)

  const {
    data: validationResult,
    isLoading: isValidating,
    isFetching: isRevalidating,
    error: validationError,
  } = useFableValidation(fable)

  // Initialize fable state - only runs once per mount
  useEffect(() => {
    if (initializedRef.current) return

    if (fableId && existingFable) {
      setFable(existingFable, fableId)
      // Restore saved title from metadata store without marking dirty
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.fable.metadata)
        if (raw) {
          const metadata = JSON.parse(raw) as FableMetadataStore
          const entry = metadata[fableId] as
            | FableMetadataStore[string]
            | undefined
          const savedTitle = entry?.title
          if (savedTitle) {
            useFableBuilderStore.setState({ fableName: savedTitle })
          }
        }
      } catch {
        // Ignore parse errors — title stays as default
      }
      initializedRef.current = true
    } else if (!fableId && !encodedState) {
      if (preset) {
        const presetConfig = getPreset(preset)
        if (presetConfig) {
          setFable(presetConfig.fable, null)
          setFableName(presetConfig.name)
        } else {
          newFable()
        }
      } else {
        newFable()
      }
      initializedRef.current = true
    } else if (!fableId && encodedState) {
      // URL state sync will handle this case
      initializedRef.current = true
    }
  }, [fableId, existingFable, preset, encodedState])

  useEffect(() => {
    setIsValidating(isValidating || isRevalidating)
  }, [isValidating, isRevalidating, setIsValidating])

  useEffect(() => {
    if (validationResult) {
      const state = toValidationState(validationResult)
      setValidationState(state)
    }
  }, [validationResult, setValidationState])

  if (catalogueLoading || (fableId && fableLoading)) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (fableId && fableError) {
    return (
      <div className="flex min-h-100 flex-col items-center justify-center gap-4">
        <P className="text-destructive">
          Failed to load configuration: {fableError.message}
        </P>
      </div>
    )
  }

  if (!catalogue) {
    return (
      <div className="flex min-h-100 flex-col items-center justify-center gap-4">
        <P className="text-destructive">Failed to load block catalogue</P>
      </div>
    )
  }

  return (
    <div
      className="flex min-w-0 flex-col"
      style={{ height: 'calc(100vh - 60px)' }}
    >
      <FableBuilderHeader fableId={fableId} catalogue={catalogue} />

      {validationError && (
        <Alert variant="destructive" className="mx-4 mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Validation Error</AlertTitle>
          <AlertDescription>
            {getValidationErrorMessage(validationError)}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {step === 'edit' ? (
          <EditStep catalogue={catalogue} isDesktop={isDesktop} mode={mode} />
        ) : (
          <ReviewStepComponent catalogue={catalogue} />
        )}
      </div>
    </div>
  )
}

interface EditStepProps {
  catalogue: BlockFactoryCatalogue
  isDesktop: boolean
  mode: 'graph' | 'form'
}

function EditStep({
  catalogue,
  isDesktop,
  mode,
}: EditStepProps): React.ReactNode {
  const { authType } = useAuth()
  const { data: user } = useUser()

  if (Object.keys(catalogue).length === 0) {
    const canManagePlugins = authType === 'anonymous' || user?.is_superuser
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <Package className="h-12 w-12 text-muted-foreground" />
        <div className="max-w-md text-center">
          <H2 className="text-lg font-semibold">No plugins enabled</H2>
          <P className="mt-1 text-muted-foreground">
            At least one plugin must be enabled to use the Fable Builder.
          </P>
          {canManagePlugins && (
            <Button
              variant="outline"
              className="mt-4"
              render={<Link to="/admin/plugins" />}
            >
              Manage Plugins
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Form mode: Render full-width without sidebars
  // Form mode has its own built-in UI for adding, configuring, and deleting blocks
  if (mode === 'form') {
    return <FableFormCanvas catalogue={catalogue} />
  }

  // Graph mode: Use three-column layout with sidebars
  const canvas = <FableGraphCanvas catalogue={catalogue} />

  if (!isDesktop) {
    return <MobileLayout catalogue={catalogue} canvas={canvas} />
  }

  return (
    <ThreeColumnLayout
      leftSidebar={<BlockPalette catalogue={catalogue} />}
      canvas={canvas}
      rightSidebar={<ConfigPanel catalogue={catalogue} />}
    />
  )
}
