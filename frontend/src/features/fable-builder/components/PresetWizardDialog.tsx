/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * PresetWizardDialog
 *
 * Modal dialog that collects parameter values for intermediate/advanced presets
 * and handles instantiation.
 *
 * Behaviour by difficulty:
 *   - beginner (0 params): caller should instantiate directly — this dialog
 *     does not render.
 *   - intermediate / advanced with ≤ 4 params: single-page form.
 *   - intermediate / advanced with > 4 params: multi-step wizard (4 params
 *     per step, last step contains the remainder).
 *
 * Footer buttons (always shown on the last step):
 *   - "Cancel"         — dismisses the dialog without any action.
 *   - "Open in Editor" — saves the blueprint (auto_run=false) and navigates to
 *                        `/configure` so the user can inspect/edit before running.
 *   - "Run Forecast"   — saves the blueprint and submits a run immediately
 *                        (auto_run=true), then navigates to `/executions/{runId}`.
 *                        Disabled when any required parameter is empty.
 */

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PresetParameterInput } from './PresetParameterInput'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type {
  HighLevelPreset,
  PresetDifficulty,
  PresetParameter,
} from '@/api/types/preset.types'
import { useFableValidation } from '@/api/hooks/useFable'
import { useInstantiatePreset } from '@/api/hooks/usePresets'
import { parseValueType } from '@/components/base/fields/value-type-parser'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { GlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { BlockValidationProvider } from '@/features/fable-builder/context/BlockValidationContext'
import { useAllGlyphs } from '@/features/fable-builder/hooks/useAllGlyphs'
import { GlyphReferencePanel } from '@/features/fable-builder/components/shared/GlyphReferencePanel'
import { createLogger } from '@/lib/logger'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of parameters shown per wizard step. */
const PARAMS_PER_STEP = 4

const log = createLogger('PresetWizardDialog')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the initial values map from parameter defaults. */
function buildInitialValues(
  parameters: ReadonlyArray<PresetParameter>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const param of parameters) {
    values[param.glyph_key] = param.default_value
  }
  return values
}

/**
 * Build a glyph_key → resolved-value map for the "resolves to" preview by
 * scanning every block's resolved configuration. A parameter's resolved value
 * is the resolved value of any block config whose raw expression was exactly
 * `${<glyph_key>}` — i.e. the block uses the parameter verbatim. Parameters
 * referenced only inside larger expressions won't appear here, which is fine:
 * the preview is best-effort and omits what it can't match cleanly.
 */
function buildResolvedConfigForWizard(
  parameters: ReadonlyArray<PresetParameter>,
  builderBlocks: Record<
    string,
    { configuration_values?: Record<string, string> }
  >,
  resolvedByBlock: Record<string, Record<string, string>> | undefined,
): Record<string, string> | null {
  if (!resolvedByBlock) return null
  const result: Record<string, string> = {}
  for (const param of parameters) {
    const marker = `\${${param.glyph_key}}`
    for (const [blockId, block] of Object.entries(builderBlocks)) {
      const raw = block.configuration_values ?? {}
      for (const [configKey, rawValue] of Object.entries(raw)) {
        if (rawValue !== marker) continue
        const resolved = resolvedByBlock[blockId][configKey]
        if (resolved && resolved !== marker) {
          result[param.glyph_key] = resolved
          break
        }
      }
      if (param.glyph_key in result) break
    }
  }
  return result
}

/** Split an array into chunks of at most `size` elements. */
function chunkArray<T>(arr: ReadonlyArray<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Returns true when every value parses cleanly against its parameter's
 * declared `value_type`. Used to gate the "Run" button so we can catch
 * invalid input (empty values, malformed dates, out-of-range enums) before
 * a server round-trip.
 */
function isFormValid(
  parameters: ReadonlyArray<PresetParameter>,
  values: Record<string, string>,
): boolean {
  return parameters.every((p) => {
    const raw = (values[p.glyph_key] ?? '').trim()
    if (raw === '') return false
    // Glyph-template defaults (e.g. ${submitDatetime}) are treated as valid —
    // the backend resolves them at instantiation time.
    if (raw.startsWith('${')) return true
    const parsed = parseValueType(p.value_type)
    switch (parsed.type) {
      case 'int':
        return /^-?\d+$/.test(raw)
      case 'float':
        return !Number.isNaN(Number(raw))
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(raw)
      case 'datetime':
        // ISO 8601 datetime; accept with or without seconds/timezone.
        return !Number.isNaN(Date.parse(raw))
      case 'enum':
        return !parsed.closed || parsed.options.includes(raw)
      default:
        return true
    }
  })
}

/**
 * Map block-level validation errors back to preset parameter glyph keys.
 *
 * The `/validate` endpoint returns errors keyed by block ID. For each block
 * config key whose raw value is exactly `${<glyph_key>}`, we attribute the
 * block's errors to that parameter. Errors that can't be attributed are
 * returned as `unmapped`.
 */
function mapBlockErrorsToParams(
  parameters: ReadonlyArray<PresetParameter>,
  blocks: Record<string, { configuration_values?: Record<string, string> }>,
  blockErrors: Record<string, ReadonlyArray<string>>,
  missingGlyphs: Record<string, Record<string, ReadonlyArray<string>>>,
): {
  fieldErrors: Record<string, Array<string>>
  unmapped: Array<string>
} {
  const fieldErrors: Record<string, Array<string>> = {}
  const unmapped: Array<string> = []

  // Build a reverse map: blockId+configKey → glyph_key
  const configToGlyph = new Map<string, string>()
  for (const param of parameters) {
    const marker = `\${${param.glyph_key}}`
    for (const [blockId, block] of Object.entries(blocks)) {
      const raw = block.configuration_values ?? {}
      for (const [configKey, rawValue] of Object.entries(raw)) {
        if (rawValue === marker) {
          configToGlyph.set(`${blockId}:${configKey}`, param.glyph_key)
        }
      }
    }
  }

  // Map block errors — try to attribute to a parameter
  for (const [blockId, errors] of Object.entries(blockErrors)) {
    for (const error of errors) {
      // Try to extract config key from known error patterns
      const missingMatch = error.match(
        /^Block contains missing config:\s*\{['"]([\w]+)['"]\}$/,
      )
      if (missingMatch) {
        const configKey = missingMatch[1]
        const glyphKey = configToGlyph.get(`${blockId}:${configKey}`)
        if (glyphKey) {
          ;(fieldErrors[glyphKey] ??= []).push(error)
          continue
        }
      }
      unmapped.push(error)
    }
  }

  // Map missing glyphs — these are directly keyed by config key per block
  for (const [blockId, configKeys] of Object.entries(missingGlyphs)) {
    for (const [configKey, glyphNames] of Object.entries(configKeys)) {
      const glyphKey = configToGlyph.get(`${blockId}:${configKey}`)
      if (glyphKey) {
        for (const name of glyphNames) {
          ;(fieldErrors[glyphKey] ??= []).push(`Unknown variable: ${name}`)
        }
      } else {
        for (const name of glyphNames) {
          unmapped.push(`Unknown variable "${name}" in ${configKey}`)
        }
      }
    }
  }

  return { fieldErrors, unmapped }
}

// ---------------------------------------------------------------------------
// Difficulty badge variant mapping
// ---------------------------------------------------------------------------

const DIFFICULTY_BADGE_VARIANT: Record<
  PresetDifficulty,
  'default' | 'secondary' | 'outline'
> = {
  beginner: 'default',
  intermediate: 'secondary',
  advanced: 'outline',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PresetWizardDialogProps {
  /** The fully-fetched preset (including parameters). */
  preset: HighLevelPreset
  /** Controls dialog visibility. */
  open: boolean
  /** Called when the dialog should close (cancel or after navigation). */
  onOpenChange: (open: boolean) => void
  /**
   * When true, the dialog renders without calling the backend `instantiate`
   * endpoint — used by the admin form to preview an unsaved preset whose
   * `preset_id` does not yet exist server-side. Both action buttons are
   * disabled.
   */
  previewMode?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetWizardDialog({
  preset,
  open,
  onOpenChange,
  previewMode = false,
}: PresetWizardDialogProps) {
  const { t } = useTranslation('presets')
  const navigate = useNavigate()
  const setFableFromPresetInstance = useFableBuilderStore(
    (s) => s.setFableFromPresetInstance,
  )
  const { mutateAsync: instantiate, isPending } = useInstantiatePreset()

  // ── Form state ────────────────────────────────────────────────────────────
  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialValues(preset.parameters),
  )
  const [currentStep, setCurrentStep] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /**
   * Track which action is in-flight so each button can show its own spinner
   * while the other remains visually idle.
   */
  const [pendingAction, setPendingAction] = useState<
    'openInEditor' | 'runForecast' | null
  >(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const isMultiStep = preset.parameters.length > PARAMS_PER_STEP
  const steps = useMemo(
    () => chunkArray(preset.parameters, PARAMS_PER_STEP),
    [preset.parameters],
  )
  const totalSteps = steps.length
  const isLastStep = currentStep === totalSteps - 1

  /** Fast client-side check — catches empty / malformed input before
   *  spending a round-trip on the backend validator. */
  const isClientValid = isFormValid(preset.parameters, values)

  /** Materialise the builder with current parameter values injected as
   *  ``local_glyphs`` — mirrors what the backend does during instantiation. */
  const previewBuilder = useMemo<FableBuilderV1>(
    () => ({
      ...preset.builder_template,
      local_glyphs: {
        ...(preset.builder_template.local_glyphs ?? {}),
        ...values,
      },
    }),
    [preset.builder_template, values],
  )

  // Ask the backend to validate the materialised blueprint. Only kicks in
  // once the client-side checks pass so we don't hammer the validator with
  // obviously-broken input.
  const { data: validation, isFetching: isValidating } = useFableValidation(
    isClientValid ? previewBuilder : null,
    isClientValid,
  )
  const isBackendValid =
    validation !== undefined &&
    validation.global_errors.length === 0 &&
    Object.keys(validation.block_errors).length === 0

  const canRunForecast = isClientValid && isBackendValid

  // Glyph context — feed it the wizard's current parameter values as local
  // glyphs so the toggle is available and the reference panel shows them.
  const { glyphs } = useAllGlyphs(values)

  // Best-effort glyph_key → resolved-value mapping for the "resolves to"
  // preview rendered by GlyphFieldWrapper.
  const resolvedConfigForWizard = useMemo(
    () =>
      buildResolvedConfigForWizard(
        preset.parameters,
        preset.builder_template.blocks,
        validation?.resolved_configuration_options,
      ),
    [preset.parameters, preset.builder_template.blocks, validation],
  )

  // Map block-level validation errors to parameter glyph keys so the
  // individual field inputs can show inline error messages.
  const { fieldErrors: fieldErrorsForWizard, unmapped: unmappedErrors } =
    useMemo(
      () =>
        validation
          ? mapBlockErrorsToParams(
              preset.parameters,
              preset.builder_template.blocks,
              validation.block_errors,
              validation.missing_glyphs,
            )
          : { fieldErrors: {}, unmapped: [] as Array<string> },
      [preset.parameters, preset.builder_template.blocks, validation],
    )

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleChange = useCallback((glyphKey: string, value: string) => {
    setValues((prev) => ({ ...prev, [glyphKey]: value }))
  }, [])

  function handleBack() {
    setCurrentStep((s) => Math.max(0, s - 1))
  }

  function handleNext() {
    setCurrentStep((s) => Math.min(totalSteps - 1, s + 1))
  }

  /**
   * "Open in Editor" — saves the blueprint (auto_run=false) then opens the
   * fable builder editor so the user can review/edit before running.
   */
  async function handleOpenInEditor() {
    setErrorMessage(null)
    setPendingAction('openInEditor')
    try {
      const result = await instantiate({
        preset_id: preset.preset_id,
        parameter_values: values,
        auto_run: false,
      })

      onOpenChange(false)
      setFableFromPresetInstance(result.builder, preset.name)
      void navigate({ to: '/configure' })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('wizard.error.description')
      log.error('Preset open-in-editor failed', {
        preset_id: preset.preset_id,
        err,
      })
      setErrorMessage(message)
    } finally {
      setPendingAction(null)
    }
  }

  /**
   * "Run Forecast" — saves the blueprint and submits a run immediately
   * (auto_run=true), then navigates to the execution detail page.
   */
  async function handleRunForecast() {
    setErrorMessage(null)
    setPendingAction('runForecast')
    try {
      const result = await instantiate({
        preset_id: preset.preset_id,
        parameter_values: values,
        auto_run: true,
      })

      onOpenChange(false)

      if (result.run_id) {
        void navigate({
          to: '/executions/$jobId',
          params: { jobId: result.run_id },
        })
      } else {
        log.warn('Instantiation returned no run_id', {
          preset_id: preset.preset_id,
        })
        void navigate({ to: '/executions' })
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('wizard.error.description')
      log.error('Preset run-forecast failed', {
        preset_id: preset.preset_id,
        err,
      })
      setErrorMessage(message)
    } finally {
      setPendingAction(null)
    }
  }

  // ── Guard: beginner presets should never open this dialog ─────────────────
  if (preset.difficulty === 'beginner') {
    return null
  }

  // ── Determine which parameters to show ────────────────────────────────────
  const currentParams: ReadonlyArray<PresetParameter> = isMultiStep
    ? (steps[currentStep] ?? [])
    : preset.parameters

  // ── Step indicator label (multi-step only) ────────────────────────────────
  const stepLabel = isMultiStep
    ? t('wizard.stepIndicator', {
        current: currentStep + 1,
        total: totalSteps,
      })
    : null

  // ── Difficulty info ───────────────────────────────────────────────────────
  const difficultyName = t(`wizard.difficulty.${preset.difficulty}.name`)
  const difficultyHint = t(`wizard.difficulty.${preset.difficulty}.hint`)
  const difficultyBadgeVariant = DIFFICULTY_BADGE_VARIANT[preset.difficulty]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // Prevent dismissal via outside click while a request is in-flight.
      disablePointerDismissal={isPending}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('wizard.title', { name: preset.name })}</DialogTitle>
          <DialogDescription>{t('wizard.subtitle')}</DialogDescription>
        </DialogHeader>

        {/* ── Scrollable body ── */}
        <div className="-mx-6 flex-1 overflow-y-auto px-6">
          {/* ── Difficulty info badge ── */}
          <div className="flex items-center gap-2">
            <Badge variant={difficultyBadgeVariant}>{difficultyName}</Badge>
            <span className="text-xs text-muted-foreground">
              {difficultyHint}
            </span>
          </div>

          {/* ── Step indicator (multi-step only) ── */}
          {stepLabel && (
            <p
              className="mt-4 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {stepLabel}
            </p>
          )}

          {/* ── Parameter form ──
              GlyphContext + BlockValidationProvider mirror the block-config
              surface so each field renders the glyph toggle, autocomplete and
              "resolves to" preview. Only the params shown on the current step
              are rendered; the reference panel below covers the full set. */}
          <GlyphContext.Provider value={glyphs}>
            <BlockValidationProvider
              fieldErrors={fieldErrorsForWizard}
              resolvedConfig={resolvedConfigForWizard}
            >
              <div className="mt-4 flex flex-col gap-4">
                {currentParams.map((param) => (
                  <PresetParameterInput
                    key={param.glyph_key}
                    parameter={param}
                    value={values[param.glyph_key] ?? ''}
                    onChange={handleChange}
                  />
                ))}
              </div>
              <GlyphReferencePanel
                className="mt-6"
                defaultCollapsed
                localGlyphOverrides={values}
              />
            </BlockValidationProvider>
          </GlyphContext.Provider>

          {/* ── Error banner ── */}
          {errorMessage && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>{t('wizard.error.title')}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {/* ── Unmapped block errors ── */}
          {unmappedErrors.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>{t('wizard.error.validationTitle')}</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {unmappedErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* ── Footer ── */}
        <DialogFooter className="gap-2 sm:gap-0">
          {/* Cancel — always visible */}
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('wizard.actions.cancel')}
          </Button>

          {/* Back — multi-step, not on first step */}
          {isMultiStep && currentStep > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={handleBack}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('wizard.actions.back')}
            </Button>
          )}

          {/* Next — multi-step, not on last step */}
          {isMultiStep && !isLastStep && (
            <Button type="button" onClick={handleNext} disabled={isPending}>
              {t('wizard.actions.next')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}

          {/* Action buttons — single-step always, multi-step only on last step */}
          {(!isMultiStep || isLastStep) && (
            <>
              {/* Open in Editor — always enabled */}
              <Button
                type="button"
                variant="outline"
                disabled={isPending || previewMode}
                title={previewMode ? t('wizard.previewModeHint') : undefined}
                onClick={() => void handleOpenInEditor()}
              >
                {pendingAction === 'openInEditor' ? (
                  <>
                    <Loader2
                      className="mr-1.5 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    {t('wizard.actions.openingInEditor')}
                  </>
                ) : (
                  t('wizard.actions.openInEditor')
                )}
              </Button>

              {/* Run Forecast — hidden for empty templates (e.g. Blank Canvas)
                  where there is nothing to run; disabled when form is incomplete. */}
              {Object.keys(preset.builder_template.blocks).length > 0 && (
                <Button
                  type="button"
                  disabled={
                    isPending || isValidating || !canRunForecast || previewMode
                  }
                  title={
                    previewMode
                      ? t('wizard.previewModeHint')
                      : !canRunForecast
                        ? t('wizard.runForecastDisabledHint')
                        : undefined
                  }
                  onClick={() => void handleRunForecast()}
                >
                  {pendingAction === 'runForecast' || isValidating ? (
                    <>
                      <Loader2
                        className="mr-1.5 h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      {pendingAction === 'runForecast'
                        ? t('wizard.actions.submittingForecast')
                        : t('wizard.actions.runForecast')}
                    </>
                  ) : (
                    t('wizard.actions.runForecast')
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
