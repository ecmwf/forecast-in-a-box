/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useConfigPresets } from '../hooks/useConfigPresets'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { PresetCard } from '@/features/dashboard/components/PresetCard'
import { H2, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'

interface ConfigPresetsSectionProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

/** "My Configuration Presets" — a card grid of saved configs, each mirroring a Forecast Journal row. */
export function ConfigPresetsSection({
  variant,
  shadow,
}: ConfigPresetsSectionProps) {
  const { t } = useTranslation('dashboard')
  const { presets, hasPresets, isLoading, toggleFavourite } = useConfigPresets()

  if (isLoading || !hasPresets) return null

  const displayPresets = presets.slice(0, 4)

  const content = (
    <>
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <H2 className="text-xl font-semibold">{t('presets.title')}</H2>
          <P className="mt-1 text-muted-foreground">{t('presets.subtitle')}</P>
        </div>
        <Link
          to="/presets/mine"
          className="inline-flex shrink-0 items-center text-sm font-medium text-primary hover:underline"
        >
          {t('presets.viewMine')}
          <ChevronRight className="ml-0.5 h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {displayPresets.map((preset) => (
          <PresetCard
            key={preset.blueprintId}
            preset={preset}
            onToggleFavourite={() => toggleFavourite(preset.blueprintId)}
          />
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
