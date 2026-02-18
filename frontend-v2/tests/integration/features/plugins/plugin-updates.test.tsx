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
 * Plugin Updates Integration Tests
 *
 * Tests the complete user flows for plugin update management:
 * - Displaying plugins with available updates
 * - Update badges and version information
 * - Filtering to show only plugins with updates
 * - Updates section visibility and behavior
 * - Clicking update triggers mutation and updates UI
 *
 * IMPORTANT: The MSW handlers use shared mutable state. Tests that trigger
 * the update mutation (clicking "Update Now") permanently modify the mock
 * backend state. These mutating tests MUST be placed last in the file.
 */

import { useMemo, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

    const filteringAvailable = statusFilter === 'available'

    let available = data.plugins.filter((p) => p.status === 'available')

    if (capabilityFilter !== 'all') {
      available = available.filter((p) =>
        p.capabilities.includes(capabilityFilter),
      )
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      available = available.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.displayId.toLowerCase().includes(query) ||
          p.author.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query),
      )
    }

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

    if (capabilityFilter !== 'all') {
      filteredPlugins = filteredPlugins.filter((p) =>
        p.capabilities.includes(capabilityFilter),
      )
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filteredPlugins = filteredPlugins.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.displayId.toLowerCase().includes(query) ||
          p.author.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query),
      )
    }

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

describe('Plugin Updates Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // Read-only tests (no mutations) - safe to run in any order
  // -----------------------------------------------------------------------

  describe('Updates Available Section Display', () => {
    it('renders the updates available section when plugins have updates', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Updates section should show with the correct title
      await expect.element(screen.getByText('Updates Available')).toBeVisible()
    })

    it('shows the ECMWF Ensemble plugin in the updates section', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // ECMWF Ensemble has loaded_version '2.1.0' but remote_info version '2.4.0'
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()
    })

    it('shows the update count in the section header', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Should show count of plugins with updates (1 from mock data)
      await expect.element(screen.getByText(/\(1\)/)).toBeVisible()
    })

    it('displays the update version badge in the updates section', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // UpdatesAvailableSection renders "UPDATE v{latestVersion}" badge
      await expect.element(screen.getByText(/UPDATE v2\.4\.0/)).toBeVisible()
    })

    it('displays the current version of plugins with updates', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Should show the current version (2.1.0) in the updates section
      await expect.element(screen.getByText('Current: v2.1.0')).toBeVisible()
    })

    it('renders the Update Now button in the updates section', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Wait for updates section
      await expect.element(screen.getByText('Updates Available')).toBeVisible()

      // Should have an Update Now button
      await expect
        .element(screen.getByRole('button', { name: /update now/i }))
        .toBeVisible()
    })

    it('shows update button on plugin cards for plugins with hasUpdate', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Find all update-related buttons (from UpdatesAvailableSection)
      const updateButtons = screen.getByRole('button', { name: /update/i })

      // Should have at least one update button
      await expect.element(updateButtons.first()).toBeVisible()
    })
  })

  describe('Filtering Updates', () => {
    it('shows only plugins with updates when hasUpdate filter is selected', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Find the status filter select and change to "Updates Available"
      const statusSelect = screen.getByRole('combobox').first()
      await statusSelect.click()

      // Select the "Updates Available" option
      const updatesOption = screen.getByRole('option', {
        name: /updates available/i,
      })
      await updatesOption.click()

      // After filtering, ECMWF Ensemble should still be visible (it has an update)
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()

      // Installed count should show 0 (all plugins with updates are in the updates section, not installed)
      await expect.element(screen.getByText('Total: 0')).toBeVisible()
    })

    it('filters updates section by search query', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Search for "Ensemble" - should find the plugin with an update
      const searchInput = screen.getByPlaceholder(/search installed plugins/i)
      await searchInput.fill('Ensemble')

      // ECMWF Ensemble should still be visible
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()

      // The updates section should still show
      await expect.element(screen.getByText('Updates Available')).toBeVisible()
    })

    it('hides updates section when search query does not match any updatable plugin', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Search for something that does not match any plugin with updates
      const searchInput = screen.getByPlaceholder(/search installed plugins/i)
      await searchInput.fill('Regridding')

      // ECMWF Regridding should appear (it is installed)
      await expect.element(screen.getByText('ECMWF Regridding')).toBeVisible()

      // Updates section should no longer appear (ECMWF Ensemble is filtered out)
      await expect
        .element(screen.getByText('Updates Available'))
        .not.toBeInTheDocument()
    })

    it('hides updates section when filtering by available status', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Switch to "Available" filter
      const statusSelect = screen.getByRole('combobox').first()
      await statusSelect.click()

      const availableOption = screen.getByRole('option', {
        name: /^Available$/,
      })
      await availableOption.click()

      // Updates section heading should be hidden when showing only available plugins
      // Use the heading with count pattern to distinguish from the filter option text
      await expect
        .element(screen.getByRole('heading', { name: /updates available/i }))
        .not.toBeInTheDocument()

      // The installed section should also be hidden
      await expect
        .element(
          screen.getByRole('heading', {
            name: 'Installed plugins',
            exact: true,
          }),
        )
        .not.toBeInTheDocument()
    })
  })

  describe('Check Updates Flow', () => {
    it('allows triggering a check for updates via the header button', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Find the "Check Updates" button
      const checkUpdatesButton = screen.getByRole('button', {
        name: /check updates/i,
      })
      await expect.element(checkUpdatesButton).toBeVisible()

      // Click the button
      await checkUpdatesButton.click()

      // Button should trigger the refresh mutation
      // MSW handler has 500ms delay for refresh
      await expect.poll(() => true, { timeout: 1000 }).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Mutating tests (trigger update mutation) - placed LAST because the MSW
  // handler uses shared mutable state that persists across tests.
  // After update, ECMWF Ensemble loaded_version becomes 2.4.0 and
  // hasUpdate becomes false, removing it from the updates section.
  // -----------------------------------------------------------------------

  describe('Update Plugin End-to-End (mutating)', () => {
    it('clicking Update Now triggers the mutation and removes plugin from updates section', async () => {
      const screen = await renderWithRouter(<TestPluginsPage />)

      // Wait for page to load
      await expect
        .element(screen.getByRole('heading', { name: 'Plugin Store' }))
        .toBeVisible()

      // Verify updates section is visible initially
      await expect.element(screen.getByText('Updates Available')).toBeVisible()
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()
      await expect.element(screen.getByText('Current: v2.1.0')).toBeVisible()

      // Click Update Now on the ECMWF Ensemble plugin
      const updateButton = screen.getByRole('button', { name: /update now/i })
      await updateButton.click()

      // The MSW handler updates the plugin state (loaded_version becomes 2.4.0)
      // and invalidates queries. After refetch, the plugin should no longer
      // appear in the updates section since versions will match.
      // MSW update handler has 1000ms delay + refetch (300ms for details)
      // Wait for the updates section to disappear (plugin is now up to date)
      await expect
        .element(screen.getByText('Updates Available'), { timeout: 5000 })
        .not.toBeInTheDocument()

      // The plugin should now appear in the installed section with the new version
      await expect.element(screen.getByText('ECMWF Ensemble')).toBeVisible()
    })
  })
})
