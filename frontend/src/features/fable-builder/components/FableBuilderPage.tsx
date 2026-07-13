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
import { Link } from '@tanstack/react-router'
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
import { TemplateParamsDialog } from './TemplateParamsDialog'
import type { TFunction } from 'i18next'
import type { PresetId } from '@/features/fable-builder/presets/presets'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import { SubmitRunDialog } from '@/features/executions/components/SubmitRunDialog'
import { deriveTemplateParameters } from '@/features/fable-builder/utils/template-parameters'
import { useAllGlyphs } from '@/features/fable-builder/hooks/useAllGlyphs'
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
import { useTemplateExampleValues } from '@/api/hooks/usePlugins'
import { H2, P } from '@/components/base/typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'
import { useUser } from '@/hooks/useUser'
import { ApiClientError } from '@/api/client'
import { showToast } from '@/lib/toast'

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
  /** Open fableId as a template: fork (create-on-save) and prefill example values */
  templateMode?: boolean
  /** Owning plugin ("store:local") for the example-values lookup */
  templatePlugin?: string
  /** Template display name for the example-values lookup */
  templateName?: string
}

export function FableBuilderPage({
  fableId,
  preset,
  encodedState,
  templateMode = false,
  templatePlugin,
  templateName,
}: FableBuilderPageProps) {
  const { t } = useTranslation(['configure', 'common'])
  const fable = useFableBuilderStore((state) => state.fable)
  const setFable = useFableBuilderStore((state) => state.setFable)
  const newFable = useFableBuilderStore((state) => state.newFable)
  const setFableName = useFableBuilderStore((state) => state.setFableName)
  const updateBlockConfigBatch = useFableBuilderStore(
    (state) => state.updateBlockConfigBatch,
  )
  const setLocalGlyph = useFableBuilderStore((state) => state.setLocalGlyph)
  const mode = useFableBuilderStore((state) => state.mode)
  const step = useFableBuilderStore((state) => state.step)
  const storeFableId = useFableBuilderStore((state) => state.fableId)
  const submitDialogOpen = useFableBuilderStore(
    (state) => state.submitDialogOpen,
  )
  const submitDialogMode = useFableBuilderStore(
    (state) => state.submitDialogMode,
  )
  const setSubmitDialogOpen = useFableBuilderStore(
    (state) => state.setSubmitDialogOpen,
  )
  const setValidationState = useFableBuilderStore(
    (state) => state.setValidationState,
  )
  const setIsValidating = useFableBuilderStore((state) => state.setIsValidating)

  const initializedRef = useRef(false)
  const [templateInitialized, setTemplateInitialized] = useState(false)
  const [templateParamsDone, setTemplateParamsDone] = useState(false)

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

    // Template mode: fork — load the template's builder without adopting its
    // identity, so saving creates a new blueprint (parent_id = the template).
    if (templateMode && fableId) {
      if (!existingFable) return
      setFable(existingFable, null)
      useFableBuilderStore.setState({
        forkParentId: fableId,
        ...(fableRetrieveData?.display_name && {
          fableName: fableRetrieveData.display_name,
        }),
      })
      initializedRef.current = true
      setTemplateInitialized(true)
      return
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
        newFable()
      }
      initializedRef.current = true
    } else if (!fableId && encodedState) {
      // URL state sync will handle this case
      initializedRef.current = true
    }
  }, [
    fableId,
    existingFable,
    fableRetrieveData,
    preset,
    encodedState,
    templateMode,
    t,
  ])

  // Template mode: collect parameters via a dialog once builder + examples
  // are ready, then overlay values (mirrors the backend's ingest overlay).
  const examplesQuery = useTemplateExampleValues(
    templateMode ? templatePlugin : undefined,
    templateMode ? templateName : undefined,
  )
  const templateExamples = examplesQuery.data
  const { glyphs: knownGlyphs, isLoading: knownGlyphsLoading } = useAllGlyphs()

  // Settled when fetched/errored — or unfetchable (deep link without params)
  const examplesSettled =
    !templatePlugin ||
    !templateName ||
    examplesQuery.isFetched ||
    examplesQuery.isError

  // Derive once from the freshly-forked builder, with intrinsics/globals
  // subtracted so the dialog never asks for e.g. ${runId}.
  const templateParams = useMemo(() => {
    if (!templateInitialized || knownGlyphsLoading) return null
    return deriveTemplateParameters(
      useFableBuilderStore.getState().fable,
      new Set(knownGlyphs.map((glyph) => glyph.name)),
    )
  }, [templateInitialized, knownGlyphs, knownGlyphsLoading])

  function applyTemplateExampleValues() {
    if (!templateExamples) return
    const { blocks } = useFableBuilderStore.getState().fable
    for (const [blockId, inputs] of Object.entries(
      templateExamples.example_values,
    )) {
      if (blockId in blocks)
        updateBlockConfigBatch(
          blockId,
          Object.fromEntries(
            Object.entries(inputs).map(([optId, inp]) => [
              optId,
              inp.example_value,
            ]),
          ),
        )
    }
  }

  function handleTemplateApply(values: Record<string, string>) {
    applyTemplateExampleValues()
    for (const [key, value] of Object.entries(values)) {
      if (value !== '') setLocalGlyph(key, value)
    }
    setTemplateParamsDone(true)
    showToast.success(t('template.applied'))
  }

  function handleTemplateSkip() {
    applyTemplateExampleValues()
    for (const [key, inp] of Object.entries(
      templateExamples?.example_glyphs ?? {},
    )) {
      setLocalGlyph(key, inp.example_value)
    }
    setTemplateParamsDone(true)
    showToast.info(t('template.prefilled'))
  }

  const templateHasParams =
    templateParams !== null &&
    (templateParams.required.length > 0 ||
      Object.keys(templateParams.prefilled).length > 0)

  const templateDialogOpen =
    templateMode && templateHasParams && examplesSettled && !templateParamsDone

  // Nothing user-facing to ask — apply any examples silently and continue
  useEffect(() => {
    if (!templateMode || templateParamsDone) return
    if (templateParams === null || !examplesSettled || templateHasParams) return
    const { blocks } = useFableBuilderStore.getState().fable
    for (const [blockId, inputs] of Object.entries(
      templateExamples?.example_values ?? {},
    )) {
      if (blockId in blocks)
        updateBlockConfigBatch(
          blockId,
          Object.fromEntries(
            Object.entries(inputs).map(([optId, inp]) => [
              optId,
              inp.example_value,
            ]),
          ),
        )
    }
    for (const [key, inp] of Object.entries(
      templateExamples?.example_glyphs ?? {},
    )) {
      setLocalGlyph(key, inp.example_value)
    }
    setTemplateParamsDone(true)
    if (templateExamples) showToast.info(t('template.prefilled'))
  }, [
    templateMode,
    templateParamsDone,
    templateParams,
    examplesSettled,
    templateHasParams,
    templateExamples,
    updateBlockConfigBatch,
    setLocalGlyph,
    t,
  ])

  useEffect(() => {
    if (templateMode && examplesQuery.isError) {
      showToast.warning(t('template.examplesUnavailable'))
    }
  }, [templateMode, examplesQuery.isError, t])

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

  if (catalogueLoading || (fableId && fableLoading)) {
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
        <FableBuilderHeader
          fableId={templateMode ? undefined : fableId}
          catalogue={catalogue}
        />

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

      {/* Lives here, not inside ReviewStep, so "Run Once" can open it straight
          from the edit canvas without first routing through the review page. */}
      <SubmitRunDialog
        open={submitDialogOpen}
        onOpenChange={setSubmitDialogOpen}
        fable={fable}
        fableId={storeFableId}
        initialMode={submitDialogMode}
      />

      {templateMode && templateParams && (
        <TemplateParamsDialog
          open={templateDialogOpen}
          params={templateParams}
          baseFable={fable}
          examples={templateExamples}
          onApply={handleTemplateApply}
          onSkip={handleTemplateSkip}
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
