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
 * PresetGalleryCard
 *
 * Displays a single high-level preset from the gallery with its icon, name,
 * description, difficulty badge, tag chips, an optional mini
 * flow preview, and a "Use This Preset" action button.
 */

import * as LucideIcons from 'lucide-react'
import { Box, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type { PresetDifficulty, PresetListItem } from '@/api/types/preset.types'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Difficulty badge
// ---------------------------------------------------------------------------

const DIFFICULTY_BADGE: Record<PresetDifficulty, string> = {
  beginner:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  intermediate:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  advanced: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

// ---------------------------------------------------------------------------
// Dynamic icon resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Lucide icon component by its PascalCase name (e.g. "Cloud",
 * "Activity"). Falls back to `Box` when the name is unknown.
 */
function resolveIcon(name: string): LucideIcons.LucideIcon {
  // Lucide exports icons in PascalCase; the preset `icon` field may arrive in
  // any casing — normalise to PascalCase just in case.
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PresetGalleryCardProps {
  preset: PresetListItem
  onSelect: (presetId: string) => void | Promise<void>
  /**
   * When the full preset has been loaded (e.g. via `usePreset`), pass its
   * `builder_template` here to render the mini flow preview.
   */
  builderTemplate?: FableBuilderV1
  /**
   * When `true` the action button shows a spinner and is disabled.
   * Set by the parent while an instantiation request is in-flight for this
   * specific card.
   */
  isLoading?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetGalleryCard({
  preset,
  onSelect,
  builderTemplate,
  isLoading = false,
}: PresetGalleryCardProps) {
  const { t } = useTranslation('dashboard')

  const Icon = resolveIcon(preset.icon)
  const difficultyBadge = DIFFICULTY_BADGE[preset.difficulty]
  const difficultyLabel = t(`presetGallery.difficulty.${preset.difficulty}.name`)
  const difficultyHint = t(`presetGallery.difficulty.${preset.difficulty}.hint`)

  return (
    <Card className="flex flex-col transition-colors hover:border-primary/40 hover:bg-muted/30">
      {/* ── Header: icon + name + difficulty badge ── */}
      <CardHeader className="gap-3">
        {/* Icon container */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <CardTitle className="line-clamp-2 text-sm leading-snug font-semibold">
            {preset.name}
          </CardTitle>

          {/* Difficulty badge — tooltip explains what the level means */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  'inline-flex shrink-0 cursor-default items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  difficultyBadge,
                )}
              >
                {difficultyLabel}
              </TooltipTrigger>
              <TooltipContent side="top">
                {difficultyHint}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>

      {/* ── Body: description + tags + flow preview ── */}
      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Short description */}
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {preset.description}
        </p>

        {/* Tag chips */}
        {preset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {preset.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Mini flow preview — only when builder_template is available */}
        {builderTemplate && (
          <div className="pt-1">
            <FableMiniFlow builder={builderTemplate} monochrome={false} />
          </div>
        )}
      </CardContent>

      {/* ── Footer: action button ── */}
      <CardFooter>
        <Button
          className="w-full"
          size="sm"
          disabled={isLoading}
          onClick={() => void onSelect(preset.preset_id)}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Launching…
            </>
          ) : (
            t('presetGallery.useThisPreset')
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
