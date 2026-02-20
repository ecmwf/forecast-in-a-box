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
 * UninstalledPluginsSection Component
 *
 * Displays plugins that are not installed, available for installation from the ECMWF Plugin Store.
 */

import { useState } from 'react'
import { Package, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PluginCard } from './PluginCard'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { H3, P } from '@/components/base/typography'
import { Input } from '@/components/ui/input'

interface UninstalledPluginsSectionProps {
  plugins: Array<PluginInfo>
  onInstall: (compositeId: PluginCompositeId) => void
  onViewDetails?: (plugin: PluginInfo) => void
  installingId?: PluginCompositeId
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function UninstalledPluginsSection({
  plugins,
  onInstall,
  onViewDetails,
  installingId,
  variant,
  shadow,
}: UninstalledPluginsSectionProps) {
  const { t } = useTranslation('plugins')
  const [searchQuery, setSearchQuery] = useState('')

  // Filter plugins by search query
  const filteredPlugins = plugins.filter((plugin) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      plugin.name.toLowerCase().includes(query) ||
      plugin.displayId.toLowerCase().includes(query) ||
      plugin.author.toLowerCase().includes(query) ||
      plugin.description.toLowerCase().includes(query)
    )
  })

  // Sort alphabetically by name
  const sortedPlugins = [...filteredPlugins].sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {t('uninstalledSection.title')}
          </H3>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="mb-4 h-16 w-16 text-muted-foreground/50" />
          <H3 className="mb-2 text-lg font-semibold">
            {t('emptyState.noUninstalled')}
          </H3>
          <P className="max-w-md text-muted-foreground">
            {t('emptyState.noUninstalledDescription')}
          </P>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 px-1">
          <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {t('uninstalledSection.title')}
          </H3>
          <span className="font-mono text-sm text-muted-foreground">
            {t('uninstalledSection.total', { count: plugins.length })}
          </span>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('uninstalledSection.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Description */}
      <P className="px-1 text-muted-foreground">
        {t('uninstalledSection.description')}
      </P>

      {/* Plugin Cards */}
      {sortedPlugins.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {sortedPlugins.map((plugin) => (
            <PluginCard
              key={plugin.displayId}
              plugin={plugin}
              onToggle={() => {}}
              onInstall={onInstall}
              onUninstall={() => {}}
              onUpdate={() => {}}
              onViewDetails={onViewDetails}
              isInstalling={
                !!installingId &&
                installingId.store === plugin.id.store &&
                installingId.local === plugin.id.local
              }
              variant={variant}
              shadow={shadow}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Package className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <P className="text-muted-foreground">{t('emptyState.title')}</P>
        </div>
      )}
    </div>
  )
}
