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
 * Section showing different ways to start a forecast configuration
 */

import { Activity, Cloud, Database, Layers } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { GettingStartedCard } from './GettingStartedCard'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import type { PresetId } from '@/features/fable-builder/presets/presets'
import { getPreset } from '@/features/fable-builder/presets/presets'
import { H2, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'

interface GettingStartedSectionProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function GettingStartedSection({
  variant,
  shadow,
}: GettingStartedSectionProps) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  const handlePresetClick = (preset: PresetId) => {
    navigate({ to: '/configure', search: { preset } })
  }

  // Builder graphs are evaluated once per render — date defaults are stamped
  // here so the flow previews always reflect the date the cards will load with.
  const ecmwfOpenDataFable = useMemo(
    () => getPreset('ecmwf-open-data')?.fable,
    [],
  )
  const aifsForecastFable = useMemo(() => getPreset('aifs-forecast')?.fable, [])
  const aifsDatasetFable = useMemo(() => getPreset('aifs-dataset')?.fable, [])

  const content = (
    <>
      <div className="mb-6">
        <H2 className="text-xl font-semibold">{t('gettingStarted.title')}</H2>
        <P className="mt-1 text-muted-foreground">
          {t('gettingStarted.subtitle')}
        </P>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Start from Scratch — blank canvas (replaces old Quick Start + Custom Forecast). */}
        <GettingStartedCard
          icon={<Layers className="h-5 w-5" />}
          title={t('gettingStarted.startFromScratch.title')}
          description={t('gettingStarted.startFromScratch.description')}
          tags={[
            t('gettingStarted.startFromScratch.tags.canvas'),
            t('gettingStarted.startFromScratch.tags.control'),
          ]}
          isRecommended
          onClick={() => handlePresetClick('custom-model')}
        />

        {/* Card 2: ECMWF Open Data — ensemble-mean 2t global PNG. */}
        <GettingStartedCard
          icon={<Cloud className="h-5 w-5" />}
          title={t('gettingStarted.ecmwfOpenData.title')}
          description={t('gettingStarted.ecmwfOpenData.description')}
          tags={[
            t('gettingStarted.ecmwfOpenData.tags.source'),
            t('gettingStarted.ecmwfOpenData.tags.statistic'),
            t('gettingStarted.ecmwfOpenData.tags.format'),
          ]}
          iconColor="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
          borderColor="border-border hover:border-blue-400"
          previewFable={ecmwfOpenDataFable}
          onClick={() => handlePresetClick('ecmwf-open-data')}
        />

        {/* Card 3: AIFS 72h Forecast — multi-sink map plots. */}
        <GettingStartedCard
          icon={<Activity className="h-5 w-5" />}
          title={t('gettingStarted.aifsForecast.title')}
          description={t('gettingStarted.aifsForecast.description')}
          tags={[
            t('gettingStarted.aifsForecast.tags.source'),
            t('gettingStarted.aifsForecast.tags.leadTime'),
            t('gettingStarted.aifsForecast.tags.format'),
          ]}
          iconColor="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
          borderColor="border-border hover:border-emerald-400"
          previewFable={aifsForecastFable}
          onClick={() => handlePresetClick('aifs-forecast')}
        />

        {/* Card 4: AIFS Ensemble Dataset — Zarr export. */}
        <GettingStartedCard
          icon={<Database className="h-5 w-5" />}
          title={t('gettingStarted.aifsDataset.title')}
          description={t('gettingStarted.aifsDataset.description')}
          tags={[
            t('gettingStarted.aifsDataset.tags.source'),
            t('gettingStarted.aifsDataset.tags.members'),
            t('gettingStarted.aifsDataset.tags.format'),
          ]}
          iconColor="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
          borderColor="border-border hover:border-purple-400"
          previewFable={aifsDatasetFable}
          onClick={() => handlePresetClick('aifs-dataset')}
        />
      </div>
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
