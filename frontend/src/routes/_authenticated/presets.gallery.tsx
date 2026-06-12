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
 * Preset Gallery Route — /presets/gallery
 *
 * Renders the browsable gallery of all published high-level presets.
 *
 * Selection behaviour (delegated to `usePresetSelection`):
 *   - Beginner presets → instant instantiation, navigate to execution page.
 *   - Intermediate presets → PresetWizardDialog opens → "Run Forecast" →
 *     navigate to execution page.
 *   - Advanced presets → PresetWizardDialog opens → "Open in Editor" →
 *     navigate to /configure.
 */

import { createFileRoute } from '@tanstack/react-router'
import { usePresetSelection } from '@/features/dashboard/hooks/usePresetSelection'
import { PresetGalleryPage } from '@/features/dashboard/components/PresetGalleryPage'

export const Route = createFileRoute('/_authenticated/presets/gallery')({
  component: GalleryPage,
})

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

function GalleryPage() {
  const { selectPreset, wizardPreset, wizardOpen, setWizardOpen } =
    usePresetSelection()

  return (
    <PresetGalleryPage
      onSelectPreset={selectPreset}
      wizardPreset={wizardPreset}
      wizardOpen={wizardOpen}
      onWizardOpenChange={setWizardOpen}
    />
  )
}
