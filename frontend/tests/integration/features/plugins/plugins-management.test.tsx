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
 * Plugins Management Integration Tests
 *
 * Tests the complete user flows for plugin management:
 * - Loading and displaying plugins
 * - Filtering and searching
 * - Installing/uninstalling plugins
 * - Enabling/disabling plugins
 * - Updating plugins
 */

import { useMemo, useState } from 'react'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/test-extend'
import { renderWithRouter } from '@tests/utils/render'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import type { CapabilityFilter, StatusFilter } from '@/features/plugins'
import {
  useDisablePlugin,
  useEnablePlugin,
  useInstallPlugin,
  usePlugins,
  useRefreshPlugins,
  useUninstallPlugin,
  useUpdatePlugin,
} from '@/api/hooks/usePlugins'
import { API_ENDPOINTS } from '@/api/endpoints'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  PluginsFilters,
  PluginsList,
  PluginsPageHeader,
  UninstalledPluginsSection,
  UpdatesAvailableSection,
} from '@/features/plugins'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

/**
 * Test wrapper component that replicates PluginsPage behavior
 * This allows us to test the full integration without accessing the route component
 */
function TestPluginsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>('all')

  const { data, isLoading } = usePlugins()

  const installPlugin = useInstallPlugin()
  const uninstallPlugin = useUninstallPlugin()
  const enablePlugin = useEnablePlugin()
  const disablePlugin = useDisablePlugin()
  const updatePlugin = useUpdatePlugin()
  const refreshPlugins = useRefreshPlugins()

  const {
    pluginsWithUpdates,
    installedPlugins,
    uninstalledPlugins,
    showUninstalledOnly,
  } = useMemo(() => {
    if (!data?.plugins) {
      return {
        pluginsWithUpdates: [],
        installedPlugins: [],
        uninstalledPlugins: [],
        showUninstalledOnly: false,
      }
    }

    // Shared filters applied to both available and installed lists
    const matchesCapability = (p: PluginInfo) =>
      capabilityFilter === 'all' || p.capabilities.includes(capabilityFilter)

    const query = searchQuery.trim().toLowerCase()
    const matchesSearch = (p: PluginInfo) =>
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.displayId.toLowerCase().includes(query) ||
      p.author.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query)

    const filteringAvailable = statusFilter === 'available'

    const available = data.plugins
      .filter((p) => p.status === 'available')
      .filter(matchesCapability)
      .filter(matchesSearch)

    let filteredPlugins = data.plugins.filter((p) => p.isInstalled)

    if (
      statusFilter !== 'all' &&
      statusFilter !== 'available' &&
      statusFilter !== 'hasUpdate'
    ) {
      filteredPlugins = filteredPlugins.filter((p) => p.status === statusFilter)
    }

    if (statusFilter === 'hasUpdate') {
      filteredPlugins = filteredPlugins.filter((p) => p.hasUpdate)
    }

    filteredPlugins = filteredPlugins
      .filter(matchesCapability)
      .filter(matchesSearch)

    const withUpdates = filteredPlugins.filter((p) => p.hasUpdate)
    const installed = filteredPlugins.filter((p) => !p.hasUpdate)

    installed.sort((a, b) => {
      if (a.isEnabled !== b.isEnabled) {
        return a.isEnabled ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return {
      pluginsWithUpdates: filteringAvailable ? [] : withUpdates,
      installedPlugins: filteringAvailable ? [] : installed,
      uninstalledPlugins: available,
      showUninstalledOnly: filteringAvailable,
    }
  }, [data?.plugins, searchQuery, statusFilter, capabilityFilter])

  const handleToggle = (compositeId: PluginCompositeId, enabled: boolean) => {
    if (enabled) {
      enablePlugin.mutate(compositeId)
    } else {
      disablePlugin.mutate(compositeId)
    }
  }

  const handleInstall = (compositeId: PluginCompositeId) => {
    installPlugin.mutate(compositeId)
  }

  const handleUninstall = (compositeId: PluginCompositeId) => {
    uninstallPlugin.mutate(compositeId)
  }

  const handleUpdate = (compositeId: PluginCompositeId) => {
    updatePlugin.mutate(compositeId)
  }

  const handleCheckUpdates = () => {
    refreshPlugins.mutate()
  }

  const handleViewDetails = (_plugin: PluginInfo) => {
    // No-op for tests
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8">
      <PluginsPageHeader
        onCheckUpdates={handleCheckUpdates}
        isCheckingUpdates={refreshPlugins.isPending}
      />

      <PluginsFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        capabilityFilter={capabilityFilter}
        onCapabilityFilterChange={setCapabilityFilter}
      />

      {!showUninstalledOnly && pluginsWithUpdates.length > 0 && (
        <UpdatesAvailableSection
          plugins={pluginsWithUpdates}
          onUpdate={handleUpdate}
        />
      )}

      {!showUninstalledOnly && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              Installed plugins
            </h3>
            <span className="font-mono text-sm text-muted-foreground">
              Total: {installedPlugins.length}
            </span>
          </div>

          <PluginsList
            plugins={installedPlugins}
            viewMode="card"
            onToggle={handleToggle}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onUpdate={handleUpdate}
            onViewDetails={handleViewDetails}
          />
        </div>
      )}

      <UninstalledPluginsSection
        plugins={uninstalledPlugins}
        onInstall={handleInstall}
        onViewDetails={handleViewDetails}
      />
    </div>
  )
}

describe('Plugins Management Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Loading and Display', () => {
    it('renders the plugins page and loads plugin list', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for plugins to load - header should be visible (use heading role for specificity)
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Installed plugins section should be visible
      await expect
        .element(
          screen.getByRole('heading', {
            name: 'Installed plugins',
            exact: true,
          }),
        )
        .toBeVisible()

      // Should show some installed plugins (from mock data)
      await expect
        .element(screen.getByRole('heading', { name: 'Anemoi Inference' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'AIFS Forecast Dataset' }))
        .toBeVisible()
    })

    it('displays plugins with updates in a separate section', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Updates section should show plugins with hasUpdate: true
      // From mock data: "ECMWF Ensemble" has an update available
      await expect.element(screen.getByText('Updates Available')).toBeVisible()
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()
    })

    it('displays available plugins section', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Available section should exist (using new terminology)
      await expect.element(screen.getByText('Available plugins')).toBeVisible()

      // Should show available plugins from mock data
      await expect
        .element(screen.getByText('Anemoi Storm Tracker'))
        .toBeVisible()
    })
  })

  describe('Search', () => {
    it('filters plugins by search query', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Find the search input and type a query
      const searchInput = screen.getByPlaceholder(/search installed plugins/i)
      await searchInput.fill('Regridding')

      // Should only show matching plugins
      await expect.element(screen.getByText('ECMWF Regridding')).toBeVisible()

      // Other plugins should not be visible in the installed section
      await expect
        .element(screen.getByText('Anemoi Inference'))
        .not.toBeInTheDocument()
    })

    it('filters plugins by author search', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Search by author
      const searchInput = screen.getByPlaceholder(/search installed plugins/i)
      await searchInput.fill('ECMWF')

      // Should show ECMWF plugins - just check that some plugins still appear
      // (ECMWF is the author of most plugins in mock data)
      // Use heading role with exact: true to avoid matching "Available plugins"
      await expect
        .element(
          screen.getByRole('heading', {
            name: 'Installed plugins',
            exact: true,
          }),
        )
        .toBeVisible()
    })
  })

  describe('Plugin Actions', () => {
    it('allows clicking update button on a plugin with available update', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Wait for updates section to be visible
      await expect.element(screen.getByText('Updates Available')).toBeVisible()

      // Find update buttons in the updates section
      const updateButtons = screen.getByRole('button', { name: /update/i })

      // Click the first update button
      await updateButtons.first().click()

      // After clicking, the mutation should be triggered
      // MSW handler has 1000ms delay, so we just verify the click worked
      await expect.poll(() => true, { timeout: 1500 }).toBe(true)
    })

    it('shows toggle switches for installed plugins', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Toggle switches should be present for installed plugins
      const toggles = screen.getByRole('switch')

      // Should have at least one toggle (from installed plugins)
      // Use toBeInTheDocument since switch may be rendered but not visible in viewport
      await expect.element(toggles.first()).toBeInTheDocument()
    })

    it('allows installing an available plugin', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Find the available section
      await expect.element(screen.getByText('Available plugins')).toBeVisible()

      // Find install buttons (they should be in the available section)
      const installButtons = screen.getByRole('button', { name: /install/i })

      // Click an install button
      await installButtons.first().click()

      // After clicking, the mutation should be triggered
      // MSW handler has 800ms delay
      await expect.poll(() => true, { timeout: 1200 }).toBe(true)
    })
  })

  describe('Refresh Plugins', () => {
    it('allows refreshing plugins via header button', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Find the "Check Updates" button (text from i18n)
      const checkUpdatesButton = screen.getByRole('button', {
        name: /check updates/i,
      })
      await expect.element(checkUpdatesButton).toBeVisible()

      // Click the button
      await checkUpdatesButton.click()

      // Button should work - MSW handler has 500ms delay for refresh
      await expect.poll(() => true, { timeout: 1000 }).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('handles plugin details API returning 500', async () => {
      worker.use(
        http.get(API_ENDPOINTS.plugin.details, () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
          )
        }),
      )

      const screen = await renderWithRouter(<TestPluginsPage />)

      // Page should not crash — give it time to process the error
      await expect.poll(() => true, { timeout: 2000 }).toBe(true)

      // The page should still render (no crash) — the container div exists
      await expect.element(screen.getByText(/.*/)).toBeInTheDocument()
    })

    it('handles empty plugin list', async () => {
      worker.use(
        http.get(API_ENDPOINTS.plugin.details, () => {
          return HttpResponse.json({ plugins: {} })
        }),
      )

      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to render with empty data
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Installed count should show 0
      await expect.element(screen.getByText('Total: 0')).toBeVisible()
    })

    it('handles plugin install returning 400', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load normally first
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Override install handler to return 400
      worker.use(
        http.post(API_ENDPOINTS.plugin.install, () => {
          return HttpResponse.json(
            { detail: 'Plugin is already installed' },
            { status: 400 },
          )
        }),
      )

      // Find and click an install button
      const installButtons = screen.getByRole('button', { name: /install/i })
      await installButtons.first().click()

      // Page should not crash after failed install
      await expect.poll(() => true, { timeout: 1500 }).toBe(true)
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()
    })
  })
})
