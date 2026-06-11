/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { LEGACY_PRESET_MAP } from '@/features/fable-builder/presets/presets'

const searchSchema = z.object({
  /**
   * @deprecated Use `hlPreset` instead.
   * Kept for one release cycle to avoid breaking bookmarked URLs.
   * When present, the value is looked up in LEGACY_PRESET_MAP and the user is
   * transparently redirected to `?hlPreset=<backend-preset-id>`.
   */
  preset: z
    .enum([
      'quick-start',
      'standard',
      'custom-model',
      'dataset',
      'ecmwf-open-data',
      'aifs-forecast',
      'aifs-dataset',
    ])
    .optional(),
  state: z.string().optional(),
  fableId: z.string().optional(),
  /** Deep-link to a high-level preset by its slug. Opens the wizard dialog
   *  (or instantiates directly for beginner presets) when the page loads. */
  hlPreset: z.string().optional(),
})

export type ConfigureSearch = z.infer<typeof searchSchema>

export const Route = createFileRoute('/_authenticated/configure')({
  validateSearch: searchSchema,
  component: ConfigurePage,
})

function ConfigurePage() {
  const { preset, state, fableId, hlPreset } = Route.useSearch()
  const navigate = useNavigate()

  // ---------------------------------------------------------------------------
  // Legacy ?preset= → ?hlPreset= redirect
  // ---------------------------------------------------------------------------
  // When a bookmarked URL contains the old `?preset=<id>` param, look up the
  // corresponding backend preset slug in LEGACY_PRESET_MAP and replace the URL
  // with `?hlPreset=<backend-preset-id>` so the new high-level preset flow is
  // triggered.  The redirect is a replace (no new history entry) so the back
  // button still works as expected.
  useEffect(() => {
    if (!preset) return

    const backendPresetId = LEGACY_PRESET_MAP[preset]
    if (!backendPresetId) return

    void navigate({
      to: '/configure',
      search: {
        // Carry over any other search params that were present
        ...(fableId !== undefined && { fableId }),
        ...(state !== undefined && { state }),
        hlPreset: backendPresetId,
      },
      replace: true,
    })
  }, [preset, fableId, state, navigate])

  // While the redirect effect is pending (preset is set but hlPreset is not yet
  // updated), render nothing to avoid a flash of the old preset behaviour.
  if (preset && !hlPreset) {
    return null
  }

  return (
    <FableBuilderPage
      key={fableId}
      fableId={fableId}
      preset={preset}
      encodedState={state}
      hlPreset={hlPreset}
    />
  )
}
