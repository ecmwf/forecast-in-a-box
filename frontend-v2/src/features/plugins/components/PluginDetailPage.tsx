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
 * PluginDetailPage Component
 *
 * Full-page view of plugin details with block factories grid,
 * replacing the previous PluginDetailsSheet sidebar.
 */

import { ArrowLeft, Layers, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  createSingleBlockFable,
  generatePluginPipeline,
} from '../utils/pipeline-generator'
import { BlockFactoryCard } from './BlockFactoryCard'
import { CapabilityBadges } from './CapabilityBadges'
import { PluginIcon } from './PluginIcon'
import { PluginStatusBadge } from './PluginStatusBadge'
import type {
  BlockFactoryCatalogue,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import type { PluginCapability, PluginInfo } from '@/api/types/plugins.types'
import { BLOCK_KIND_ORDER, getFactory } from '@/api/types/fable.types'
import { toPluginDisplayId } from '@/api/types/plugins.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { encodeFableToURL } from '@/features/fable-builder/utils/url-state'
import { H1, H2, P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

export interface PluginDetailPageProps {
  plugin: PluginInfo
  catalogue: BlockFactoryCatalogue | undefined
}

export function PluginDetailPage({ plugin, catalogue }: PluginDetailPageProps) {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    Set<PluginCapability>
  >(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const handleCapabilityToggle = useCallback((capability: PluginCapability) => {
    setSelectedCapabilities((prev) => {
      const next = new Set(prev)
      if (next.has(capability)) {
        next.delete(capability)
      } else {
        next.add(capability)
      }
      return next
    })
  }, [])

  const pluginDisplayId = toPluginDisplayId(plugin.id)
  const pluginCatalogue = catalogue?.[pluginDisplayId]
  const blockCount = pluginCatalogue
    ? Object.keys(pluginCatalogue.factories).length
    : 0

  // Filter and sort factories
  const sortedFactories = useMemo(() => {
    if (!pluginCatalogue) return []

    let entries = Object.entries(pluginCatalogue.factories)

    // Filter by selected capabilities
    if (selectedCapabilities.size > 0) {
      entries = entries.filter(([_, factory]) =>
        selectedCapabilities.has(factory.kind),
      )
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      entries = entries.filter(
        ([name, factory]) =>
          factory.title.toLowerCase().includes(query) ||
          name.toLowerCase().includes(query) ||
          factory.description.toLowerCase().includes(query),
      )
    }

    // Sort by kind order, then alphabetically
    return entries.sort((a, b) => {
      const kindOrderA = BLOCK_KIND_ORDER.indexOf(a[1].kind)
      const kindOrderB = BLOCK_KIND_ORDER.indexOf(b[1].kind)
      if (kindOrderA !== kindOrderB) {
        return kindOrderA - kindOrderB
      }
      return a[0].localeCompare(b[0])
    })
  }, [pluginCatalogue, selectedCapabilities, searchQuery])

  const handleStartConfiguration = (factoryId: PluginBlockFactoryId) => {
    if (!catalogue) return

    const factory = getFactory(catalogue, factoryId)
    if (!factory) return

    const fable = createSingleBlockFable(factoryId, factory)
    const encoded = encodeFableToURL(fable)

    navigate({
      to: '/configure',
      search: { state: encoded },
    })
  }

  const handleUseAllBlocks = () => {
    if (!catalogue) return

    const { fable } = generatePluginPipeline({
      pluginId: pluginDisplayId,
      catalogue,
    })

    const encoded = encodeFableToURL(fable)

    navigate({
      to: '/configure',
      search: { state: encoded },
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Back button */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        render={<Link to="/admin/plugins" />}
      >
        <ArrowLeft className="h-4 w-4" />
        {t('detail.backToPlugins')}
      </Button>

      {/* Plugin header */}
      <div className="flex items-start gap-4">
        <PluginIcon plugin={plugin} size="lg" />
        <div className="min-w-0 flex-1">
          <H1 className="text-2xl font-bold">{plugin.name}</H1>
          <P className="mt-1 text-muted-foreground">
            {plugin.author}
            {plugin.version && ` · v${plugin.version}`}
          </P>
          <div className="mt-2">
            <PluginStatusBadge
              status={plugin.status}
              hasUpdate={plugin.hasUpdate}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      {plugin.description && (
        <P className="text-muted-foreground">{plugin.description}</P>
      )}

      {/* Capabilities + Use All Blocks */}
      {(plugin.capabilities.length > 0 ||
        (pluginCatalogue && blockCount > 1)) && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {plugin.capabilities.length > 0 && (
            <CapabilityBadges
              capabilities={plugin.capabilities}
              selectedCapabilities={selectedCapabilities}
              onToggle={handleCapabilityToggle}
            />
          )}
          {pluginCatalogue && blockCount > 1 && (
            <Button
              className="gap-2"
              variant="outline"
              onClick={handleUseAllBlocks}
            >
              <Layers className="h-4 w-4" />
              {t('detail.useAllBlocks', { count: blockCount })}
            </Button>
          )}
        </div>
      )}

      <Separator />

      {/* Block Factories */}
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <H2 className="text-lg font-semibold">
            {t('detail.blockFactories')}
            {blockCount > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                ({blockCount})
              </span>
            )}
          </H2>
          {blockCount > 3 && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('detail.searchBlocks')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn('pl-9')}
              />
            </div>
          )}
        </div>

        {pluginCatalogue ? (
          sortedFactories.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sortedFactories.map(([factoryName, factory]) => (
                <BlockFactoryCard
                  key={factoryName}
                  factory={factory}
                  onStartConfiguration={() =>
                    handleStartConfiguration({
                      plugin: plugin.id,
                      factory: factoryName,
                    })
                  }
                />
              ))}
            </div>
          ) : searchQuery.trim() || selectedCapabilities.size > 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {t('detail.noMatchingBlocks')}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              {t('detail.noBlocks')}
            </div>
          )
        ) : plugin.isInstalled && plugin.isEnabled ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading block factories...
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            {plugin.isInstalled
              ? 'Enable this plugin to view block factories.'
              : 'Install this plugin to view block factories.'}
          </div>
        )}
      </div>
    </div>
  )
}
