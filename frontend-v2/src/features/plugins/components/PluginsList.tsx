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
 * PluginsList Component
 *
 * Renders plugins in either table or card view based on store state.
 * Follows the ForecastJournal pattern for responsive table design.
 */

import { ChevronLeft, ChevronRight, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PluginCard } from './PluginCard'
import { PluginRow } from './PluginRow'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import type {
  AdminViewMode,
  DashboardVariant,
  PanelShadow,
} from '@/stores/uiStore'
import { H3, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { useMedia } from '@/hooks/useMedia'

interface PluginsListProps {
  plugins: Array<PluginInfo>
  viewMode: AdminViewMode
  onToggle: (compositeId: PluginCompositeId, enabled: boolean) => void
  onInstall: (compositeId: PluginCompositeId) => void
  onUninstall: (compositeId: PluginCompositeId) => void
  onUpdate: (compositeId: PluginCompositeId) => void
  onViewDetails?: (plugin: PluginInfo) => void
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function PluginsList({
  plugins,
  viewMode,
  onToggle,
  onInstall,
  onUninstall,
  onUpdate,
  onViewDetails,
  variant,
  shadow,
}: PluginsListProps) {
  const { t } = useTranslation('plugins')

  // Force card view on mobile (below Tailwind's sm breakpoint)
  const isMobile = useMedia('(max-width: 639px)')
  const effectiveViewMode = isMobile ? 'card' : viewMode

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Package className="mb-4 h-16 w-16 text-muted-foreground/50" />
        <H3 className="mb-2 text-lg font-semibold">{t('emptyState.title')}</H3>
        <P className="max-w-md text-muted-foreground">
          {t('emptyState.description')}
        </P>
      </div>
    )
  }

  // Card view (forced on mobile)
  if (effectiveViewMode === 'card') {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {plugins.map((plugin) => (
          <PluginCard
            key={plugin.displayId}
            plugin={plugin}
            onToggle={onToggle}
            onInstall={onInstall}
            onUninstall={onUninstall}
            onUpdate={onUpdate}
            onViewDetails={onViewDetails}
            variant={variant}
            shadow={shadow}
          />
        ))}
      </div>
    )
  }

  // Table view - using ForecastJournal pattern
  return (
    <Card className="overflow-hidden" variant={variant} shadow={shadow}>
      {/* Header Row (Hidden on mobile) */}
      <div className="hidden grid-cols-12 gap-4 border-b border-border bg-muted/50 px-6 py-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase sm:grid">
        <div className="col-span-5">{t('table.headers.plugin')}</div>
        <div className="col-span-3">{t('table.headers.author')}</div>
        <div className="col-span-2">{t('table.headers.status')}</div>
        <div className="col-span-2 text-right">
          {t('table.headers.actions')}
        </div>
      </div>

      {/* Plugin Rows */}
      <div className="divide-y divide-border">
        {plugins.map((plugin) => (
          <PluginRow
            key={plugin.displayId}
            plugin={plugin}
            onToggle={onToggle}
            onUninstall={onUninstall}
            onViewDetails={onViewDetails}
          />
        ))}
      </div>

      {/* Footer/Pagination */}
      <div className="flex items-center justify-between border-t border-border bg-muted/50 px-6 py-4">
        <span className="text-sm text-muted-foreground">
          {t('pagination.showing', {
            start: 1,
            end: plugins.length,
            total: plugins.length,
          })}
        </span>
        <div className="flex gap-2">
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </Card>
  )
}
