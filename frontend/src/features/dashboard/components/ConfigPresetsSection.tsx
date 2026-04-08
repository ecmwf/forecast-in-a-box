/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { ChevronRight, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useConfigPresets } from '../hooks/useConfigPresets'
import type { PresetEntry } from '../hooks/useConfigPresets'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { Badge } from '@/components/ui/badge'
import { H2, H3, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ConfigPresetsSectionProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

function PresetCard({ preset }: { preset: PresetEntry }) {
  const title = preset.displayName || preset.blueprintId.slice(0, 8)
  const comments = preset.displayDescription || ''
  const tags = preset.tags

  return (
    <Link
      to="/configure"
      search={{ fableId: preset.blueprintId }}
      className={cn(
        'relative flex h-full cursor-pointer flex-col rounded-lg border p-5 transition-colors',
        'bg-card',
        'border-border hover:border-amber-400/60 hover:bg-muted/40',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <H3 className="truncate text-base font-bold">{title}</H3>
        {preset.isFavourite && (
          <Star className="h-4 w-4 shrink-0 fill-amber-500 text-amber-500" />
        )}
      </div>

      {comments && (
        <P className="mb-3 line-clamp-2 leading-relaxed text-muted-foreground">
          {comments}
        </P>
      )}

      <div className="mt-auto space-y-3">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

export function ConfigPresetsSection({
  variant,
  shadow,
}: ConfigPresetsSectionProps) {
  const { t } = useTranslation('dashboard')
  const { presets, hasPresets, isLoading } = useConfigPresets()

  if (isLoading || !hasPresets) return null

  const displayPresets = presets.slice(0, 4)

  const content = (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <H2 className="text-xl font-semibold">{t('presets.title')}</H2>
          <P className="mt-1 text-muted-foreground">{t('presets.subtitle')}</P>
        </div>
        <Link
          to="/presets"
          className="inline-flex items-center text-sm font-medium text-primary hover:underline"
        >
          {t('presets.viewAll')}
          <ChevronRight className="ml-0.5 h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {displayPresets.map((preset) => (
          <PresetCard key={preset.blueprintId} preset={preset} />
        ))}
      </div>
    </>
  )

  if (variant === 'modern') {
    return <div className="space-y-6">{content}</div>
  }

  return (
    <Card className="p-8" variant={variant} shadow={shadow}>
      {content}
    </Card>
  )
}
