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
 * GettingStartedSection Component
 *
 * Section showing up to 4 "featured" presets fetched from the backend preset
 * API.  Falls back to a "Start from Scratch" card when the API is unavailable.
 *
 * Selection behaviour (orchestrated by `usePresetSelection`):
 *   - Beginner presets → instant instantiation, navigate to execution page.
 *   - Intermediate presets → PresetWizardDialog opens → "Run Forecast" →
 *     navigate to execution page.
 *   - Advanced presets → PresetWizardDialog opens → "Open in Editor" →
 *     navigate to /configure.
 */

import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { Box, ChevronRight, Layers, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { GettingStartedCard } from './GettingStartedCard'
import type { PresetListItem } from '@/api/types/preset.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { usePresetList } from '@/api/hooks/usePresets'
import { usePresetSelection } from '@/features/dashboard/hooks/usePresetSelection'
import { PresetWizardDialog } from '@/features/fable-builder/components/PresetWizardDialog'
import { H2, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GettingStartedSectionProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a Lucide icon component by its PascalCase name.
 * Falls back to `Box` when the name is unknown or empty.
 */
function resolveIcon(name: string): LucideIcons.LucideIcon {
  if (!name) return Box
  const pascal =
    name.charAt(0).toUpperCase() +
    name.slice(1).replace(/-./g, (m) => m[1].toUpperCase())
  const icon = (LucideIcons as Record<string, unknown>)[pascal]
  if (
    typeof icon === 'function' ||
    (typeof icon === 'object' && icon !== null)
  ) {
    return icon as LucideIcons.LucideIcon
  }
  return Box
}

/**
 * Pick an accent colour pair (icon bg + border hover) based on the preset's
 * position in the list so the cards have visual variety without needing
 * per-preset colour data from the backend.
 */
const ACCENT_COLOURS: Array<{ iconColor: string; borderColor: string }> = [
  {
    iconColor: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    borderColor: 'border-border hover:border-blue-400',
  },
  {
    iconColor:
      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-border hover:border-emerald-400',
  },
  {
    iconColor:
      'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    borderColor: 'border-border hover:border-purple-400',
  },
  {
    iconColor:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    borderColor: 'border-border hover:border-amber-400',
  },
]

// ---------------------------------------------------------------------------
// Loading skeleton — 4 placeholder cards matching the real card layout
// ---------------------------------------------------------------------------

function GettingStartedSkeleton() {
  const { t } = useTranslation('dashboard')
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      aria-busy="true"
      aria-label={t('gettingStarted.loading.ariaLabel')}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border p-5">
          {/* Icon placeholder */}
          <Skeleton className="h-10 w-10 rounded-lg" />
          {/* Title */}
          <Skeleton className="h-4 w-3/4" />
          {/* Description lines */}
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          {/* Tags */}
          <div className="mt-auto flex gap-2">
            <Skeleton className="h-6 w-16 rounded" />
            <Skeleton className="h-6 w-20 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fallback — shown when the preset API is unavailable
// ---------------------------------------------------------------------------

function UnavailableFallback() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Generic "New Configuration" card as the sole fallback option */}
      <GettingStartedCard
        icon={<Layers className="h-5 w-5" />}
        title={t('gettingStarted.unavailable.newConfigurationTitle')}
        description={t('gettingStarted.unavailable.newConfigurationDescription')}
        tags={[]}
        isRecommended
        onClick={() => void navigate({ to: '/configure' })}
      />

      {/* Unavailable notice card */}
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-5 text-center text-muted-foreground md:col-span-1 lg:col-span-3">
        <LayoutGrid className="h-8 w-8 opacity-40" aria-hidden="true" />
        <p className="text-sm font-medium">{t('gettingStarted.unavailable.title')}</p>
        <p className="text-xs">{t('gettingStarted.unavailable.description')}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dynamic preset cards
// ---------------------------------------------------------------------------

interface PresetCardsProps {
  presets: Array<PresetListItem>
  onSelectPreset: (presetId: string) => Promise<void>
  loadingPresetId: string | null
}

function PresetCards({ presets, onSelectPreset, loadingPresetId }: PresetCardsProps) {
  // Track which card is in a loading state so we can show a spinner.
  // We use local state to wrap the async call and clear it when done.
  const [localLoadingId, setLocalLoadingId] = useState<string | null>(null)

  // Prefer the externally-provided loadingPresetId (from the hook) so the
  // spinner stays visible during the full async flow (fetch + instantiate).
  const effectiveLoadingId = loadingPresetId ?? localLoadingId

  async function handleClick(presetId: string) {
    if (effectiveLoadingId !== null) return
    setLocalLoadingId(presetId)
    try {
      await onSelectPreset(presetId)
    } finally {
      setLocalLoadingId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {presets.map((preset, index) => {
        const Icon = resolveIcon(preset.icon)
        const accent = ACCENT_COLOURS[index % ACCENT_COLOURS.length]
        const isLoading = effectiveLoadingId === preset.preset_id

        return (
          <GettingStartedCard
            key={preset.preset_id}
            icon={<Icon className="h-5 w-5" aria-hidden="true" />}
            title={preset.name}
            description={preset.description}
            tags={preset.tags.filter((tag) => tag !== 'featured').slice(0, 3)}
            iconColor={accent.iconColor}
            borderColor={accent.borderColor}
            previewFable={preset.builder_template}
            isLoading={isLoading}
            onClick={() => void handleClick(preset.preset_id)}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GettingStartedSection({
  variant,
  shadow,
}: GettingStartedSectionProps) {
  const { t } = useTranslation('dashboard')

  // Fetch the full preset list and derive the "featured" subset client-side.
  // A large page size ensures we capture all featured presets in one request.
  const { data: presets, isLoading, isError } = usePresetList(undefined, 1, 100)

  const featured = presets?.presets
    .filter((p) => p.tags.includes('featured'))
    .sort((a, b) => {
      if (a.preset_id === 'blank-canvas') return -1
      if (b.preset_id === 'blank-canvas') return 1
      return 0
    })
    .slice(0, 4)

  // Determine which content to render
  const showSkeleton = isLoading
  const showFallback = !isLoading && (isError || (featured !== undefined && featured.length === 0))
  const showCards = !isLoading && !isError && featured && featured.length > 0

  // ── Preset selection orchestration ───────────────────────────────────────
  const { selectPreset, loadingPresetId, wizardPreset, wizardOpen, setWizardOpen } =
    usePresetSelection()

  // ── Render ────────────────────────────────────────────────────────────────
  const content = (
    <>
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <H2 className="text-xl font-semibold">{t('gettingStarted.title')}</H2>
          <P className="mt-1 text-muted-foreground">
            {t('gettingStarted.subtitle')}
          </P>
        </div>
        <Link
          to="/presets/gallery"
          className="inline-flex shrink-0 items-center text-sm font-medium text-primary hover:underline"
        >
          {t('presets.viewAll')}
          <ChevronRight className="ml-0.5 h-3 w-3" />
        </Link>
      </div>

      {showSkeleton && <GettingStartedSkeleton />}
      {showFallback && <UnavailableFallback />}
      {showCards && (
        // Cast: the Zod-inferred type marks optional fields as
        // `string | null | undefined`; the PresetListItem interface uses
        // `string | null`.  The values are runtime-compatible.
        <PresetCards
          presets={featured as Array<PresetListItem>}
          onSelectPreset={selectPreset}
          loadingPresetId={loadingPresetId}
        />
      )}

      {/* ── Wizard dialog (intermediate / advanced presets) ── */}
      {wizardPreset && (
        <PresetWizardDialog
          preset={wizardPreset}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
        />
      )}
    </>
  )

  // Modern variant: no card wrapper, content floats on page background
  if (variant === 'modern') {
    return <div className="space-y-6">{content}</div>
  }

  return (
    <Card className="p-8" variant={variant} shadow={shadow}>
      {content}
    </Card>
  )
}
