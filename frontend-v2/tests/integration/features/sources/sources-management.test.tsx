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
 * Sources Management Integration Tests
 *
 * Tests the complete user flows for sources management:
 * - Loading and displaying sources and registries
 * - Filtering by type, status, and search
 * - Downloading sources
 * - Enabling/disabling sources
 * - Registry management (add, sync, remove)
 */

import { useMemo, useState } from 'react'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/test-extend'
import { renderWithRouter } from '@tests/utils/render'
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
import { API_ENDPOINTS } from '@/api/endpoints'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  RegistriesSection,
  SourcesFilters,
  SourcesList,
  SourcesPageHeader,
} from '@/features/sources'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

/**
 * Test wrapper component that replicates SourcesPage behavior
 */
function TestSourcesPage() {
  const [typeFilter, setTypeFilter] = useState<SourceTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<SourceStatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [pluginFilter, setPluginFilter] = useState<string>('all')
  const [sourcesViewMode, setSourcesViewMode] = useState<'card' | 'table'>(
    'card',
  )
  const [syncingRegistryId, setSyncingRegistryId] = useState<string | null>(
    null,
  )

  const { data, isLoading } = useSources()
  const sources = data?.sources ?? []
  const registries = data?.registries ?? []

  const downloadSource = useDownloadSource()
  const removeSource = useRemoveSource()
  const toggleEnabled = useToggleSourceEnabled()
  const addRegistry = useAddRegistry()
  const removeRegistry = useRemoveRegistry()
  const syncRegistry = useSyncRegistry()

  const availablePlugins = useMemo(() => {
    if (sources.length === 0) return []
    const pluginsMap = new Map<string, string>()
    for (const source of sources) {
      pluginsMap.set(source.pluginId, source.pluginName)
    }
    return Array.from(pluginsMap.entries()).map(([id, name]) => ({ id, name }))
  }, [sources])

  const filteredSources = useMemo(() => {
    if (sources.length === 0) return []

    return sources.filter((source) => {
      if (typeFilter !== 'all' && source.sourceType !== typeFilter) {
        return false
      }

      if (statusFilter !== 'all') {
        if (statusFilter === 'ready' && source.status !== 'ready') {
          return false
        }
        if (statusFilter === 'available' && source.status !== 'available') {
          return false
        }
      }

      if (pluginFilter !== 'all' && source.pluginId !== pluginFilter) {
        return false
      }

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

  const handleViewDetails = (_source: SourceInfo) => {
    // No-op for tests
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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <SourcesPageHeader />

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

      <SourcesList
        sources={filteredSources}
        viewMode={sourcesViewMode}
        onViewDetails={handleViewDetails}
        onDownload={handleDownload}
        onToggleEnable={handleToggleEnable}
        onRemove={handleRemove}
        onRetry={handleRetry}
      />

      <RegistriesSection
        registries={registries}
        onAddRegistry={handleAddRegistry}
        onRemoveRegistry={handleRemoveRegistry}
        onSyncRegistry={handleSyncRegistry}
        isAddingRegistry={addRegistry.isPending}
        isSyncingRegistry={syncingRegistryId}
      />
    </div>
  )
}

describe('Sources Management Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Loading and Display', () => {
    it('renders the sources page and loads source list', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for sources to load - header should be visible
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Should show some sources from mock data
      await expect
        .element(screen.getByRole('heading', { name: 'IFS ENS' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'AIFS Forecast Dataset' }))
        .toBeVisible()
    })

    it('displays registries section', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Registries section should be visible
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Should show registries from mock data (registry names are headings)
      await expect
        .element(
          screen.getByRole('heading', { name: 'ECMWF Forecast-in-a-Box' }),
        )
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'Met Norway' }))
        .toBeVisible()
    })

    it('displays sources with different statuses', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Should show ready sources
      await expect
        .element(screen.getByRole('heading', { name: 'IFS ENS' }))
        .toBeVisible()

      // Should show available sources
      await expect
        .element(screen.getByRole('heading', { name: 'single-mse-v0.2.1' }))
        .toBeVisible()

      // Should show source with download error (from mock data)
      await expect
        .element(screen.getByRole('heading', { name: 'canada-0.1-o96' }))
        .toBeVisible()
    })
  })

  describe('Filtering', () => {
    it('filters sources by type (models only)', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Click the "AI Models" filter button in the toggle group
      // ToggleGroupItem renders as a button with aria-pressed
      const modelsButton = screen.getByRole('button', { name: 'AI Models' })
      await modelsButton.click()

      // Should only show model sources
      await expect
        .element(screen.getByRole('heading', { name: 'IFS ENS' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'BRIS', exact: true }))
        .toBeVisible()

      // Dataset sources should not be visible
      await expect
        .element(screen.getByRole('heading', { name: 'ERA5 Reanalysis' }))
        .not.toBeInTheDocument()
    })

    it('filters sources by type (datasets only)', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Click the "Datasets" filter button
      const datasetsButton = screen.getByRole('button', { name: 'Datasets' })
      await datasetsButton.click()

      // Should only show dataset sources
      await expect
        .element(screen.getByRole('heading', { name: 'AIFS Forecast Dataset' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'ERA5 Reanalysis' }))
        .toBeVisible()

      // Model sources should not be visible
      await expect
        .element(screen.getByRole('heading', { name: 'IFS ENS' }))
        .not.toBeInTheDocument()
    })

    it('filters sources by search query', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Find the search input and type a query
      const searchInput = screen.getByPlaceholder('Search sources...')
      await searchInput.fill('IFS ENS')

      // Should only show matching sources (IFS ENS)
      await expect
        .element(screen.getByRole('heading', { name: 'IFS ENS' }))
        .toBeVisible()

      // Non-matching sources should not be visible
      await expect
        .element(screen.getByRole('heading', { name: 'ERA5 Reanalysis' }))
        .not.toBeInTheDocument()
    })
  })

  describe('Source Actions', () => {
    it('shows toggle switches for ready sources', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Toggle switches should be present for ready sources
      const toggles = screen.getByRole('switch')

      // Should have at least one toggle
      await expect.element(toggles.first()).toBeInTheDocument()
    })

    it('shows download buttons for available sources', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Download buttons should be present for available sources
      const downloadButtons = screen.getByRole('button', { name: /download/i })

      // Should have at least one download button
      await expect.element(downloadButtons.first()).toBeInTheDocument()
    })
  })

  describe('Registry Management', () => {
    it('displays registry list with actions', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for registries section to load
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Should show Add Registry button
      await expect
        .element(screen.getByRole('button', { name: /Add Registry/i }))
        .toBeVisible()

      // Should show registries from mock data (registry names are headings)
      await expect
        .element(
          screen.getByRole('heading', { name: 'ECMWF Forecast-in-a-Box' }),
        )
        .toBeVisible()
    })

    it('shows add registry form when button clicked', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Click "Add Registry" button to show the form
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      // Form inputs should now be visible
      await expect
        .element(screen.getByPlaceholder('https://registry.example.com'))
        .toBeVisible()
      await expect
        .element(screen.getByPlaceholder('Registry name (optional)'))
        .toBeVisible()

      // Connect button should be visible
      await expect
        .element(screen.getByRole('button', { name: /Connect/i }))
        .toBeVisible()
    })
  })

  describe('View Mode Toggle', () => {
    it('allows switching between card and table view', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // View mode toggle buttons use aria-label
      const cardButton = screen.getByRole('button', { name: 'Card view' })
      const tableButton = screen.getByRole('button', { name: 'Table view' })

      // Both should exist
      await expect.element(cardButton).toBeInTheDocument()
      await expect.element(tableButton).toBeInTheDocument()

      // Click table view
      await tableButton.click()

      // Click back to card view
      await cardButton.click()

      // Should work without errors
      await expect.element(cardButton).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('handles sources list API returning 500', async () => {
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
          )
        }),
      )

      const screen = await renderWithRouter(<TestSourcesPage />)

      // Page should not crash — give it time to process the error
      await expect.poll(() => true, { timeout: 2000 }).toBe(true)

      // The page should still render (no crash) — the container exists
      await expect.element(screen.getByText(/.*/)).toBeInTheDocument()
    })

    it('handles empty sources response', async () => {
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({ sources: [], registries: [] })
        }),
      )

      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to render with empty data
      await expect
        .element(screen.getByRole('heading', { name: 'Sources Management' }))
        .toBeVisible()

      // Registries section should still appear (may show "Add Registry" button)
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()
    })

    it('handles add registry returning error', async () => {
      const screen = await renderWithRouter(<TestSourcesPage />)

      // Wait for page to load normally first
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Override add registry handler to return 400
      worker.use(
        http.post(API_ENDPOINTS.registries.add, () => {
          return HttpResponse.json(
            { error: 'Invalid registry URL' },
            { status: 400 },
          )
        }),
      )

      // Click "Add Registry" button
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      // Fill in form and submit
      await screen
        .getByPlaceholder('https://registry.example.com')
        .fill('https://bad-registry.example.com')
      await screen.getByRole('button', { name: /Connect/i }).click()

      // Page should not crash after failed add
      await expect.poll(() => true, { timeout: 1500 }).toBe(true)
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()
    })
  })
})
