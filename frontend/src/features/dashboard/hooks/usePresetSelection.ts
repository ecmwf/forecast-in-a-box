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
 * usePresetSelection
 *
 * Shared orchestration hook for the three-tier preset selection flow:
 *
 *   - **Beginner** (0 params): Calls `useInstantiatePreset` directly, shows a
 *     brief loading toast, then navigates to `/executions/{runId}`.
 *
 *   - **Intermediate**: Fetches the full preset via the query cache, then opens
 *     `PresetWizardDialog`.  On "Run Forecast" the dialog navigates to the
 *     execution page.
 *
 *   - **Advanced**: Fetches the full preset, then opens `PresetWizardDialog`.
 *     On "Open in Editor" the dialog loads the builder and navigates to
 *     `/configure`.
 *
 * Returns the state and callbacks needed to render the wizard dialog alongside
 * any component that lists presets.
 */

import { useCallback, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import type { HighLevelPreset } from '@/api/types/preset.types'
import { presetKeys, useInstantiatePreset } from '@/api/hooks/usePresets'
import { showToast } from '@/lib/toast'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UsePresetSelectionReturn {
  /**
   * Call this when the user clicks a preset card.  Handles all three tiers
   * automatically.  Safe to call concurrently — subsequent calls while a
   * request is in-flight are silently ignored.
   */
  selectPreset: (presetId: string) => Promise<void>

  /**
   * `true` while a beginner preset is being instantiated or a full preset
   * detail is being fetched.  Use this to show a loading indicator on the
   * card that was clicked.
   */
  loadingPresetId: string | null

  /**
   * The fully-fetched preset that should be shown in the wizard dialog.
   * `null` when no wizard is open.
   */
  wizardPreset: HighLevelPreset | null

  /**
   * Whether the wizard dialog is currently open.
   */
  wizardOpen: boolean

  /**
   * Pass directly to `PresetWizardDialog`'s `onOpenChange` prop.
   */
  setWizardOpen: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePresetSelection(): UsePresetSelectionReturn {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { mutateAsync: instantiate, isPending } = useInstantiatePreset()

  // Guard against concurrent requests.
  const pendingRef = useRef<string | null>(null)

  // Track which card is showing a loading spinner.
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null)

  // Wizard dialog state.
  const [wizardPreset, setWizardPreset] = useState<HighLevelPreset | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const selectPreset = useCallback(
    async (presetId: string) => {
      // Prevent concurrent requests.
      if (isPending || pendingRef.current !== null) return
      pendingRef.current = presetId
      setLoadingPresetId(presetId)

      try {
        // Fetch (or reuse cached) full preset details.  We always need the
        // full preset to know the difficulty and parameter list.
        const preset = await queryClient.fetchQuery<HighLevelPreset>({
          queryKey: presetKeys.detail(presetId),
          queryFn: () =>
            import('@/api/endpoints/preset').then(({ getPreset }) =>
              getPreset(presetId),
            ),
          staleTime: 5 * 60 * 1000,
        })

        if (preset.difficulty === 'beginner') {
          // ── Beginner: instant instantiation, no wizard ─────────────────
          const loadingToastId = showToast.loading(
            t('presetGallery.toast.launchingForecast'),
          )

          try {
            const result = await instantiate({
              preset_id: presetId,
              parameter_values: {},
            })

            showToast.dismiss(loadingToastId)

            if (result.run_id) {
              showToast.success(
                t('presetGallery.toast.forecastLaunched'),
                preset.name,
              )
              void navigate({
                to: '/executions/$jobId',
                params: { jobId: result.run_id },
              })
            } else {
              showToast.warning(
                t('presetGallery.toast.presetInstantiated'),
                t('presetGallery.toast.noRunIdReturned'),
              )
              void navigate({ to: '/executions' })
            }
          } catch (err) {
            showToast.dismiss(loadingToastId)
            showToast.error(
              t('presetGallery.toast.failedToLaunch'),
              err instanceof Error
                ? err.message
                : i18n.t('errors:toast.tryAgain'),
            )
          }
        } else {
          // ── Intermediate / Advanced: open the wizard dialog ────────────
          setWizardPreset(preset)
          setWizardOpen(true)
        }
      } catch (err) {
        showToast.error(
          t('presetGallery.toast.couldNotLoad'),
          err instanceof Error ? err.message : i18n.t('errors:toast.tryAgain'),
        )
      } finally {
        pendingRef.current = null
        setLoadingPresetId(null)
      }
    },
    [instantiate, isPending, navigate, queryClient],
  )

  const handleSetWizardOpen = useCallback((open: boolean) => {
    setWizardOpen(open)
    // Clear the preset reference once the dialog has fully closed so that
    // stale data is not shown if the same dialog is reopened later.
    if (!open) {
      setWizardPreset(null)
    }
  }, [])

  return {
    selectPreset,
    loadingPresetId,
    wizardPreset,
    wizardOpen,
    setWizardOpen: handleSetWizardOpen,
  }
}
