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
 * SourcesList Component
 *
 * Renders sources in either table or card view
 */

import { ChevronLeft, ChevronRight, Cloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SourceCard } from './SourceCard'
import { SourceRow } from './SourceRow'
import type { SourceInfo } from '@/api/types/sources.types'
import type {
  AdminViewMode,
  DashboardVariant,
  PanelShadow,
} from '@/stores/uiStore'
import { H3, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { useMedia } from '@/hooks/useMedia'

interface SourcesListProps {
  sources: Array<SourceInfo>
  viewMode?: AdminViewMode
  onViewDetails?: (source: SourceInfo) => void
  onDownload?: (sourceId: string) => void
  onToggleEnable?: (sourceId: string, enabled: boolean) => void
  onRemove?: (sourceId: string) => void
  onRetry?: (sourceId: string) => void
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function SourcesList({
  sources,
  viewMode = 'card',
  onViewDetails,
  onDownload,
  onToggleEnable,
  onRemove,
  onRetry,
  variant,
  shadow,
}: SourcesListProps) {
  const { t } = useTranslation('sources')

  // Force card view on mobile (below Tailwind's sm breakpoint)
  const isMobile = useMedia('(max-width: 639px)')
  const effectiveViewMode = isMobile ? 'card' : viewMode

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Cloud className="mb-4 h-16 w-16 text-muted-foreground/50" />
        <H3 className="mb-2 text-lg font-semibold">{t('emptyState.title')}</H3>
        <P className="max-w-md text-muted-foreground">
          {t('emptyState.description')}
        </P>
      </div>
    )
  }

  // Table view (not shown on mobile)
  if (effectiveViewMode === 'table') {
    return (
      <Card className="overflow-hidden" variant={variant} shadow={shadow}>
        {/* Header */}
        <div className="hidden gap-4 border-b bg-muted/50 px-6 py-3 text-sm font-medium text-muted-foreground sm:grid sm:grid-cols-12">
          <div className="sm:col-span-4">{t('table.source')}</div>
          <div className="sm:col-span-2">{t('table.type')}</div>
          <div className="sm:col-span-2">{t('table.status')}</div>
          <div className="sm:col-span-2">{t('table.plugin')}</div>
          <div className="text-right sm:col-span-2">{t('table.actions')}</div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onViewDetails={onViewDetails}
              onDownload={onDownload}
              onToggleEnable={onToggleEnable}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-muted/30 px-6 py-4">
          <span className="text-sm text-muted-foreground">
            {t('table.showing', { count: sources.length })}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md p-1.5 hover:bg-muted disabled:opacity-50"
              disabled
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">1</span>
            <button
              className="rounded-md p-1.5 hover:bg-muted disabled:opacity-50"
              disabled
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Card>
    )
  }

  // Card view (default)
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {sources.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          onViewDetails={onViewDetails}
          onDownload={onDownload}
          onToggleEnable={onToggleEnable}
          onRemove={onRemove}
          onRetry={onRetry}
          variant={variant}
          shadow={shadow}
        />
      ))}
    </div>
  )
}
