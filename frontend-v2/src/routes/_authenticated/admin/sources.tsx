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
 * Sources Page Route (Admin)
 *
 * Sources Management page for browsing and managing data sources:
 * AI models and datasets from connected registries.
 */

import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { SourceInfo } from '@/api/types/sources.types'
import type {
  SourceStatusFilter,
  SourceTypeFilter,
} from '@/features/sources/components/SourcesFilters'
import {
  useAddRegistry,
  useDownloadSource,
  useRemoveRegistry,
  useRemoveSource,
  useSources,
  useSyncRegistry,
  useToggleSourceEnabled,
} from '@/api/hooks/useSources'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  RegistriesSection,
  SourcesFilters,
  SourcesList,
  SourcesPageHeader,
} from '@/features/sources'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

export const Route = createFileRoute('/_authenticated/admin/sources')({
  component: SourcesPage,
})

function SourcesPage() {
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)
  const sourcesViewMode = useUiStore((state) => state.sourcesViewMode)
  const setSourcesViewMode = useUiStore((state) => state.setSourcesViewMode)

  // Filter state
  const [typeFilter, setTypeFilter] = useState<SourceTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<SourceStatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [pluginFilter, setPluginFilter] = useState<string>('all')

  // Track which registry is syncing
  const [syncingRegistryId, setSyncingRegistryId] = useState<string | null>(
    null,
  )

  // Queries - now returns both sources and registries
  const { data, isLoading } = useSources()
  const sources = data?.sources ?? []
  const registries = data?.registries ?? []

  // Source Mutations
  const downloadSource = useDownloadSource()
  const removeSource = useRemoveSource()
  const toggleEnabled = useToggleSourceEnabled()

  // Registry Mutations
  const addRegistry = useAddRegistry()
  const removeRegistry = useRemoveRegistry()
  const syncRegistry = useSyncRegistry()

  // Get unique plugins for filter dropdown
  const availablePlugins = useMemo(() => {
    if (sources.length === 0) return []
    const pluginsMap = new Map<string, string>()
    for (const source of sources) {
      pluginsMap.set(source.pluginId, source.pluginName)
    }
    return Array.from(pluginsMap.entries()).map(([id, name]) => ({ id, name }))
  }, [sources])

  // Filter sources
  const filteredSources = useMemo(() => {
    if (sources.length === 0) return []

    return sources.filter((source) => {
      // Type filter
      if (typeFilter !== 'all' && source.sourceType !== typeFilter) {
        return false
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'ready' && source.status !== 'ready') {
          return false
        }
        if (statusFilter === 'available' && source.status !== 'available') {
          return false
        }
      }

      // Plugin filter
      if (pluginFilter !== 'all' && source.pluginId !== pluginFilter) {
        return false
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return (
          source.name.toLowerCase().includes(query) ||
          source.description.toLowerCase().includes(query) ||
          source.pluginName.toLowerCase().includes(query)
        )
      }

      return true
    })
  }, [sources, typeFilter, statusFilter, pluginFilter, searchQuery])

  // Handlers
  const handleViewDetails = (_source: SourceInfo) => {
    // TODO: Open details dialog
  }

  const handleDownload = (sourceId: string) => {
    downloadSource.mutate(sourceId)
  }

  const handleToggleEnable = (sourceId: string, enabled: boolean) => {
    toggleEnabled.mutate(sourceId, enabled)
  }

  const handleRemove = (sourceId: string) => {
    removeSource.mutate(sourceId)
  }

  const handleRetry = (sourceId: string) => {
    downloadSource.mutate(sourceId)
  }

  // Registry handlers
  const handleAddRegistry = (url: string, name?: string) => {
    addRegistry.mutate({ url, name: name ?? url })
  }

  const handleRemoveRegistry = (registryId: string) => {
    removeRegistry.mutate(registryId)
  }

  const handleSyncRegistry = (registryId: string) => {
    setSyncingRegistryId(registryId)
    syncRegistry.mutate(registryId, {
      onSettled: () => setSyncingRegistryId(null),
    })
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'mx-auto space-y-6 overflow-x-hidden px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      {/* Page Header */}
      <SourcesPageHeader />

      {/* Filters */}
      <SourcesFilters
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={sourcesViewMode}
        onViewModeChange={setSourcesViewMode}
        pluginFilter={pluginFilter}
        onPluginChange={setPluginFilter}
        availablePlugins={availablePlugins}
      />

      {/* Sources List */}
      <SourcesList
        sources={filteredSources}
        viewMode={sourcesViewMode}
        onViewDetails={handleViewDetails}
        onDownload={handleDownload}
        onToggleEnable={handleToggleEnable}
        onRemove={handleRemove}
        onRetry={handleRetry}
        variant={dashboardVariant}
        shadow={panelShadow}
      />

      {/* Source Registries */}
      <RegistriesSection
        registries={registries}
        onAddRegistry={handleAddRegistry}
        onRemoveRegistry={handleRemoveRegistry}
        onSyncRegistry={handleSyncRegistry}
        isAddingRegistry={addRegistry.isPending}
        isSyncingRegistry={syncingRegistryId}
        variant={dashboardVariant}
        shadow={panelShadow}
      />
    </div>
  )
}
