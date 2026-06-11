/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Package } from 'lucide-react'
import { FableBuilderHeader } from './FableBuilderHeader'
import { BlockPalette } from './layout/BlockPalette'
import { ConfigPanel } from './layout/ConfigPanel'
import { MobileLayout } from './layout/MobileLayout'
import { ThreeColumnLayout } from './layout/ThreeColumnLayout'
import { FableGraphCanvas } from './graph-mode/FableGraphCanvas'
import { FableFormCanvas } from './form-mode/FableFormCanvas'
import { ReviewStep as ReviewStepComponent } from './review/ReviewStep'
import { PresetWizardDialog } from './PresetWizardDialog'
import type { TFunction } from 'i18next'
import type { PresetId } from '@/features/fable-builder/presets/presets'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import { useURLStateSync } from '@/features/fable-builder/hooks/useURLStateSync'
import {
  clearDraft,
  readDraft,
  useDraftPersistence,
} from '@/features/fable-builder/hooks/useDraftPersistence'
import { getPreset } from '@/features/fable-builder/presets/presets'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { hasUnterminatedGlyph } from '@/features/fable-builder/utils/glyph-display'
import { useDebounce } from '@/hooks/useDebounce'
import { useMedia } from '@/hooks/useMedia'
import { GlyphProvider } from '@/features/fable-builder/context/GlyphContext'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { toValidationState } from '@/api/types/fable.types'
import {
  useBlockCatalogue,
  useFable,
  useFableRetrieve,
  useFableValidation,
} from '@/api/hooks/useFable'
import { useInstantiatePreset, usePreset } from '@/api/hooks/usePresets'
import { H2, P } from '@/components/base/typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'
import { useUser } from '@/hooks/useUser'
import { ApiClientError } from '@/api/client'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'

const log = createLogger('FableBuilderPage')

/**
 * Extract a user-friendly error message from a validation error
 */
function getValidationErrorMessage(
  error: Error,
  t: TFunction<['configure', 'common']>,
): string {
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
      return t('page.validationError422')
    }
  }
  return error.message || t('page.validationErrorGeneric')
}

interface FableBuilderPageProps {
  fableId?: string
  preset?: PresetId
  encodedState?: string
  /** High-level preset ID for deep-linking. When present the preset is fetched
   *  and the wizard dialog is opened automatically (or the preset is
   *  instantiated directly for beginner presets). */
  hlPreset?: string
}

export function FableBuilderPage({
  fableId,
  preset,
  encodedState,
  hlPreset,
}: FableBuilderPageProps) {
  const { t } = useTranslation(['configure', 'common'])
  const navigate = useNavigate()
  const fable = useFableBuilderStore((state) => state.fable)
  const setFable = useFableBuilderStore((state) => state.setFable)
  const newFable = useFableBuilderStore((state) => state.newFable)
  const setFableName = useFableBuilderStore((state) => state.setFableName)
  const setFableFromPresetInstance = useFableBuilderStore(
    (state) => state.setFableFromPresetInstance,
  )
  const mode = useFableBuilderStore((state) => state.mode)
  const step = useFableBuilderStore((state) => state.step)
  const setValidationState = useFableBuilderStore(
    (state) => state.setValidationState,
  )
  const setIsValidating = useFableBuilderStore((state) => state.setIsValidating)

  // ── hlPreset deep-link state ───────────────────────────────────────────────
  /** Whether the wizard dialog triggered by `hlPreset` is open. */
  const [hlPresetWizardOpen, setHlPresetWizardOpen] = useState(false)
  /** Tracks whether we have already acted on the `hlPreset` param so we don't
   *  re-trigger the wizard on every re-render. */
  const hlPresetHandledRef = useRef(false)

  // Fetch the full preset when `hlPreset` is present in the URL.
  const {
    data: hlPresetData,
    isLoading: hlPresetLoading,
    error: hlPresetError,
  } = usePreset(hlPreset ?? null)

  const { mutateAsync: instantiatePreset } = useInstantiatePreset()

  const initializedRef = useRef(false)

  // Auto-persist drafts to localStorage + beforeunload guard
  useDraftPersistence()

  useURLStateSync({
    encodedState: fableId ? undefined : encodedState,
    enabled: !fableId,
  })

  const isDesktop = useMedia('(min-width: 768px)')

  const {
    data: catalogue,
    isLoading: catalogueLoading,
    refetch: refetchCatalogue,
  } = useBlockCatalogue()
  const {
    data: existingFable,
    isLoading: fableLoading,
    error: fableError,
  } = useFable(fableId ?? null)
  const { data: fableRetrieveData } = useFableRetrieve(fableId ?? null)

  // Coalesce keystrokes: toValidationState rebuilds nested objects, so a
  // per-keystroke validation would re-render every canvas node.
  const debouncedFable = useDebounce(fable, 300)

  // Skip validation while any `${` is unterminated — backend 500s on Jinja
  // parse errors; keepPreviousData retains the last successful resolution.
  const fableHasOpenGlyph = useMemo(() => {
    for (const block of Object.values(debouncedFable.blocks)) {
      for (const val of Object.values(block.configuration_values)) {
        if (hasUnterminatedGlyph(val)) return true
      }
    }
    for (const val of Object.values(debouncedFable.local_glyphs ?? {})) {
      if (hasUnterminatedGlyph(val)) return true
    }
    return false
  }, [debouncedFable])

  const {
    data: validationResult,
    isLoading: isValidating,
    isFetching: isRevalidating,
    error: validationError,
  } = useFableValidation(debouncedFable, !fableHasOpenGlyph)

  // Initialize fable state - only runs once per mount.
  // Checks for a stale draft in localStorage before loading from backend.
  useEffect(() => {
    if (initializedRef.current) return

    // If the store already holds a preset-instantiated builder (set by
    // PresetWizardDialog just before navigating here), keep it and discard any
    // stale draft from a prior editing session — otherwise the draft would
    // overwrite the freshly-instantiated preset.
    if (!fableId && !encodedState) {
      const { fable: currentFable, isDirty } = useFableBuilderStore.getState()
      if (Object.keys(currentFable.blocks).length > 0 && isDirty) {
        clearDraft()
        initializedRef.current = true
        return
      }
    }

    // Check for a recoverable draft before normal initialization
    const draft = readDraft()
    if (draft) {
      const draftMatchesRoute =
        (fableId && draft.fableId === fableId) || (!fableId && !draft.fableId)

      if (draftMatchesRoute && Object.keys(draft.fable.blocks).length > 0) {
        const ago = Math.round((Date.now() - draft.savedAt) / 60_000)
        const timeLabel =
          ago < 1
            ? t('draftRestored.justNow')
            : t('draftRestored.minutesAgo', { count: ago })

        showToast.info(t('draftRestored.toast', { timeLabel }), draft.fableName)
        setFable(draft.fable, draft.fableId)
        if (draft.fableName) setFableName(draft.fableName)
        if (draft.fableVersion) {
          useFableBuilderStore.setState({
            fableVersion: draft.fableVersion,
            isDirty: true,
          })
        } else {
          useFableBuilderStore.setState({ isDirty: true })
        }
        clearDraft()
        initializedRef.current = true
        return
      }

      // Draft doesn't match current route — discard silently
      clearDraft()
    }

    if (fableId && existingFable) {
      setFable(existingFable, fableId)
      // Restore saved metadata from backend without marking dirty
      if (fableRetrieveData) {
        useFableBuilderStore.setState({
          fableVersion: fableRetrieveData.version,
          ...(fableRetrieveData.display_name && {
            fableName: fableRetrieveData.display_name,
          }),
        })
      }
      initializedRef.current = true
    } else if (!fableId && !encodedState) {
      if (preset) {
        const presetConfig = getPreset(preset)
        setFable(presetConfig.fable, null)
        setFableName(presetConfig.name)
      } else {
        // If the store already holds a preset-instantiated builder (loaded by
        // PresetWizardDialog via setFableFromPresetInstance before navigating
        // here), do NOT reset it.  We detect this by checking that the fable
        // has blocks AND is marked dirty (isDirty is always true after
        // setFableFromPresetInstance, whereas a freshly-reset store is clean).
        const { fable: currentFable, isDirty } = useFableBuilderStore.getState()
        const hasPresetBuilder =
          Object.keys(currentFable.blocks).length > 0 && isDirty
        if (!hasPresetBuilder) {
          newFable()
        }
      }
      initializedRef.current = true
    } else if (!fableId && encodedState) {
      // URL state sync will handle this case
      initializedRef.current = true
    }
  }, [fableId, existingFable, fableRetrieveData, preset, encodedState, t])

  // ── hlPreset deep-link handler ─────────────────────────────────────────────
  // Runs once the preset data has been fetched. Behaviour by difficulty:
  //   - beginner:      instantiate immediately (no wizard), navigate to execution.
  //   - intermediate / advanced with params: open the wizard dialog.
  //   - advanced with no params: instantiate immediately, load into editor.
  // If the store already contains a materialized builder from a prior wizard
  // submission (advanced preset → navigate to /configure), we skip re-opening
  // the wizard so the user lands directly in the editor.
  useEffect(() => {
    if (!hlPreset) return
    if (hlPresetHandledRef.current) return
    if (hlPresetLoading) return
    if (!hlPresetData) {
      if (hlPresetError) {
        log.warn('hlPreset not found or failed to load', {
          hlPreset,
          error: hlPresetError,
        })
        showToast.error(
          t('configure:page.hlPresetNotFound', 'Preset not found'),
          t(
            'configure:page.hlPresetNotFoundDescription',
            'The linked preset could not be loaded.',
          ),
        )
        hlPresetHandledRef.current = true
      }
      return
    }

    hlPresetHandledRef.current = true

    const { difficulty, parameters, name } = hlPresetData

    // Advanced preset: if the store already has a materialized builder (set by
    // the wizard before navigating here), skip re-opening the wizard.
    if (difficulty === 'advanced' && Object.keys(fable.blocks).length > 0) {
      // Builder already loaded via setFableFromPresetInstance — nothing to do.
      log.debug('hlPreset: advanced preset already materialized in store', {
        hlPreset,
      })
      return
    }

    if (difficulty === 'beginner') {
      // Instantiate directly — no wizard needed.
      const loadingToastId = showToast.loading(
        t('configure:page.hlPresetLaunching', 'Launching forecast…'),
      )
      instantiatePreset({ preset_id: hlPreset, parameter_values: {} })
        .then((result) => {
          showToast.dismiss(loadingToastId)
          if (result.run_id) {
            showToast.success(
              t('configure:page.hlPresetLaunched', 'Forecast launched'),
              name,
            )
            void navigate({
              to: '/executions/$jobId',
              params: { jobId: result.run_id },
            })
          } else {
            showToast.warning(
              t('configure:page.hlPresetInstantiated', 'Preset instantiated'),
              t(
                'configure:page.hlPresetNoRunId',
                'No run ID returned — check the executions list.',
              ),
            )
            void navigate({ to: '/executions' })
          }
        })
        .catch((err: unknown) => {
          showToast.dismiss(loadingToastId)
          showToast.error(
            t('configure:page.hlPresetLaunchFailed', 'Failed to launch preset'),
            err instanceof Error
              ? err.message
              : t('configure:page.hlPresetTryAgain', 'Please try again.'),
          )
          log.error('hlPreset beginner instantiation failed', {
            hlPreset,
            err,
          })
        })
      return
    }

    if (difficulty === 'advanced' && parameters.length === 0) {
      // Advanced preset with no parameters: instantiate directly and load into editor.
      const loadingToastId = showToast.loading(
        t('configure:page.hlPresetLoading', 'Loading preset…'),
      )
      instantiatePreset({ preset_id: hlPreset, parameter_values: {} })
        .then((result) => {
          showToast.dismiss(loadingToastId)
          setFableFromPresetInstance(result.builder, name)
        })
        .catch((err: unknown) => {
          showToast.dismiss(loadingToastId)
          showToast.error(
            t('configure:page.hlPresetLoadFailed', 'Failed to load preset'),
            err instanceof Error
              ? err.message
              : t('configure:page.hlPresetTryAgain', 'Please try again.'),
          )
          log.error('hlPreset advanced (no-param) instantiation failed', {
            hlPreset,
            err,
          })
        })
      return
    }

    // Intermediate or advanced with parameters: open the wizard dialog.
    setHlPresetWizardOpen(true)
  }, [
    hlPreset,
    hlPresetData,
    hlPresetLoading,
    hlPresetError,
    fable.blocks,
    instantiatePreset,
    navigate,
    setFableFromPresetInstance,
    t,
  ])

  // Sync React Query validation state → Zustand store for sibling components
  useEffect(() => {
    setIsValidating(isValidating || isRevalidating)
  }, [isValidating, isRevalidating, setIsValidating])

  useEffect(() => {
    if (validationResult) {
      setValidationState(
        toValidationState(validationResult, debouncedFable, catalogue),
      )
    }
  }, [catalogue, debouncedFable, validationResult, setValidationState])

  if (catalogueLoading || (fableId && fableLoading) || hlPresetLoading) {
    return (
      <div className="flex min-h-100 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (fableId && fableError) {
    const isNotFound =
      fableError instanceof ApiClientError && fableError.status === 404
    return (
      <div className="flex min-h-100 flex-col items-center justify-center gap-4">
        <P className="text-lg font-medium">
          {isNotFound ? t('page.notFoundTitle') : t('page.loadFailedTitle')}
        </P>
        <P className="text-muted-foreground">
          {isNotFound ? t('page.notFoundDescription') : fableError.message}
        </P>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/dashboard" />}
        >
          {t('page.backToDashboard')}
        </Button>
      </div>
    )
  }

  if (!catalogue) {
    return (
      <div className="flex min-h-100 flex-col items-center justify-center gap-4">
        <P className="text-destructive">{t('page.catalogueLoadFailed')}</P>
        <Button variant="outline" onClick={() => refetchCatalogue()}>
          {t('common:retry')}
        </Button>
      </div>
    )
  }

  return (
    <GlyphProvider>
      <div
        className="flex min-w-0 flex-col"
        style={{ height: 'calc(100vh - 7rem)' }}
      >
        <FableBuilderHeader fableId={fableId} catalogue={catalogue} />

        {/* Wrapper is relative so the validation banner overlays absolutely —
            toggling it must not shift the canvas. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {validationError && (
            <Alert
              variant="destructive"
              className="absolute top-2 right-4 left-4 z-10 shadow-lg"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('page.validationErrorTitle')}</AlertTitle>
              <AlertDescription>
                {getValidationErrorMessage(validationError, t)}
              </AlertDescription>
            </Alert>
          )}
          {step === 'edit' ? (
            <EditStep catalogue={catalogue} isDesktop={isDesktop} mode={mode} />
          ) : (
            <ReviewStepComponent catalogue={catalogue} />
          )}
        </div>
      </div>

      {/* hlPreset wizard dialog — rendered outside the canvas div so it is
          not clipped by overflow:hidden. Only mounted when a valid preset with
          parameters has been fetched via the ?hlPreset= URL param. */}
      {hlPresetData &&
        hlPresetData.difficulty !== 'beginner' &&
        hlPresetData.parameters.length > 0 && (
          <PresetWizardDialog
            preset={hlPresetData}
            open={hlPresetWizardOpen}
            onOpenChange={setHlPresetWizardOpen}
          />
        )}
    </GlyphProvider>
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
  const { t } = useTranslation('configure')
  const { authType } = useAuth()
  const { data: user } = useUser()

  if (Object.keys(catalogue).length === 0) {
    const canManagePlugins = authType === 'anonymous' || user?.is_superuser
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <Package className="h-12 w-12 text-muted-foreground" />
        <div className="max-w-md text-center">
          <H2 className="text-lg font-semibold">{t('page.noPluginsTitle')}</H2>
          <P className="mt-1 text-muted-foreground">
            {t('page.noPluginsDescription')}
          </P>
          {canManagePlugins && (
            <Button
              variant="outline"
              className="mt-4"
              nativeButton={false}
              render={<Link to="/admin/plugins" />}
            >
              {t('page.managePlugins')}
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
