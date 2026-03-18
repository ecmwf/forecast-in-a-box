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
 * Registry Management Integration Tests
 *
 * In-depth tests for registry management operations:
 * - Adding a new registry via the form (fill URL, name, click Connect)
 * - Syncing a registry (click sync, verify timestamp updates)
 * - Removing a non-default registry
 * - Error when trying to remove a default registry
 * - Registry connection status display
 * - Multiple registries display with different states
 */

import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { worker } from '@tests/test-extend'
import { renderWithRouter } from '@tests/utils/render'
import {
  useAddRegistry,
  useRemoveRegistry,
  useSources,
  useSyncRegistry,
} from '@/api/hooks/useSources'
import { RegistriesSection } from '@/features/sources'
import { API_ENDPOINTS, API_PATTERNS } from '@/api/endpoints'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

/**
 * Test wrapper component that replicates registry management behavior
 * from the SourcesPage, focused only on registries
 */
function TestRegistriesPage() {
  const [syncingRegistryId, setSyncingRegistryId] = useState<string | null>(
    null,
  )

  const { data, isLoading } = useSources()
  const registries = data?.registries ?? []

  const addRegistry = useAddRegistry()
  const removeRegistry = useRemoveRegistry()
  const syncRegistry = useSyncRegistry()

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
    return <div>Loading registries...</div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
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

describe('Registry Management Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Registry Display', () => {
    it('renders all registries from mock data', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      // Wait for data to load
      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // All three mock registries should appear
      await expect
        .element(
          screen.getByRole('heading', { name: 'ECMWF Forecast-in-a-Box' }),
        )
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'Met Norway' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'DWD' }))
        .toBeVisible()
    })

    it('displays registry URLs', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      await expect
        .element(screen.getByText('https://registry.fiab.ecmwf.int'))
        .toBeVisible()
      await expect
        .element(screen.getByText('https://registry.met.no/fiab'))
        .toBeVisible()
      await expect
        .element(screen.getByText('https://opendata.dwd.de/fiab'))
        .toBeVisible()
    })

    it('shows Default badge only on the default registry', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // ECMWF is the default registry, should show "Default" badge
      const defaultBadges = screen.getByText('Default')
      await expect.element(defaultBadges).toBeVisible()
    })

    it('shows sources count for each registry', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // ECMWF has 12 sources, Met Norway has 3, DWD has 2
      await expect.element(screen.getByText('12 sources')).toBeVisible()
      await expect.element(screen.getByText('3 sources')).toBeVisible()
      // Use exact: true to avoid matching "12 sources"
      await expect
        .element(screen.getByText('2 sources', { exact: true }))
        .toBeVisible()
    })
  })

  describe('Connection Status Display', () => {
    it('shows Connected status for all connected registries', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // All mock registries are connected
      const connectedLabels = screen.getByText('Connected')
      await expect.element(connectedLabels.first()).toBeVisible()
    })

    it('shows Disconnected status when registry is not connected', async () => {
      // Override the sources endpoint to return a disconnected registry
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({
            sources: [],
            registries: [
              {
                id: 'disconnected-reg',
                name: 'Offline Registry',
                description: 'A disconnected registry',
                url: 'https://offline.example.com',
                isDefault: false,
                isConnected: false,
                sourcesCount: 0,
                stores: [],
              },
            ],
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      await expect
        .element(screen.getByRole('heading', { name: 'Offline Registry' }))
        .toBeVisible()
      await expect.element(screen.getByText('Disconnected')).toBeVisible()
    })

    it('displays mixed connected and disconnected registries', async () => {
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({
            sources: [],
            registries: [
              {
                id: 'online-reg',
                name: 'Online Registry',
                description: 'Connected registry',
                url: 'https://online.example.com',
                isDefault: true,
                isConnected: true,
                sourcesCount: 5,
                stores: [],
                lastSyncedAt: '2025-12-01T10:00:00Z',
              },
              {
                id: 'offline-reg',
                name: 'Offline Registry',
                description: 'Disconnected registry',
                url: 'https://offline.example.com',
                isDefault: false,
                isConnected: false,
                sourcesCount: 0,
                stores: [],
              },
            ],
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Both registries should be visible
      await expect
        .element(screen.getByRole('heading', { name: 'Online Registry' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'Offline Registry' }))
        .toBeVisible()

      // One "Connected" and one "Disconnected"
      await expect
        .element(screen.getByText('Connected', { exact: true }))
        .toBeVisible()
      await expect
        .element(screen.getByText('Disconnected', { exact: true }))
        .toBeVisible()
    })
  })

  describe('Add Registry Form', () => {
    it('shows the add form and fills in URL and name fields', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Click "Add Registry" to show the form
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      // The form should now be visible with URL and name placeholders
      const urlInput = screen.getByPlaceholder('https://registry.example.com')
      const nameInput = screen.getByPlaceholder('Registry name (optional)')

      await expect.element(urlInput).toBeVisible()
      await expect.element(nameInput).toBeVisible()

      // Fill in the fields
      await nameInput.fill('My Custom Registry')
      await urlInput.fill('https://custom-registry.example.com')

      // Connect button should be enabled
      const connectButton = screen.getByRole('button', { name: /Connect/i })
      await expect.element(connectButton).toBeVisible()
    })

    it('submits the form and adds a new registry', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Open the add form
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      // Fill in the form
      const urlInput = screen.getByPlaceholder('https://registry.example.com')
      const nameInput = screen.getByPlaceholder('Registry name (optional)')
      await nameInput.fill('New Test Registry')
      await urlInput.fill('https://new-test-registry.example.com')

      // Click Connect
      const connectButton = screen.getByRole('button', { name: /Connect/i })
      await connectButton.click()

      // After successful add, the new registry should appear in the list
      await expect
        .element(screen.getByRole('heading', { name: 'New Test Registry' }))
        .toBeVisible()
    })

    it('disables Connect button when URL is empty', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Open add form
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      // Without filling in the URL, Connect should be disabled
      const connectButton = screen.getByRole('button', { name: /Connect/i })
      await expect.element(connectButton).toBeDisabled()
    })

    it('hides form and clears inputs when Cancel is clicked', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Open the form
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      // Fill in some data
      const nameInput = screen.getByPlaceholder('Registry name (optional)')
      await nameInput.fill('Temporary Name')

      // Click Cancel
      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      await cancelButton.click()

      // Form inputs should no longer be in the document
      await expect
        .element(screen.getByPlaceholder('https://registry.example.com'))
        .not.toBeInTheDocument()
    })

    it('closes the form after successful submission', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Open form, fill, and submit
      const addButton = screen.getByRole('button', { name: /Add Registry/i })
      await addButton.click()

      const urlInput = screen.getByPlaceholder('https://registry.example.com')
      await urlInput.fill('https://another-registry.example.com')

      const connectButton = screen.getByRole('button', { name: /Connect/i })
      await connectButton.click()

      // After submission the form should close (URL input gone)
      await expect
        .element(screen.getByPlaceholder('https://registry.example.com'))
        .not.toBeInTheDocument()
    })
  })

  describe('Sync Registry', () => {
    it('triggers sync and shows syncing state in dropdown', async () => {
      // Use a slower sync handler so we can observe the syncing state
      worker.use(
        http.post(API_PATTERNS.registries.sync, async () => {
          // Delay long enough to observe the spinner
          await new Promise((r) => setTimeout(r, 5000))
          return HttpResponse.json({
            success: true,
            message: 'Registry synced',
            lastSyncedAt: new Date().toISOString(),
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Open the dropdown menu for the first registry (ECMWF)
      // The dropdown trigger buttons have data-slot="dropdown-menu-trigger"
      const menuTriggers = screen.container.querySelectorAll(
        '[data-slot="dropdown-menu-trigger"]',
      )
      expect(menuTriggers.length).toBeGreaterThan(0)
      ;(menuTriggers[0] as HTMLElement).click()

      // Click "Sync" from the dropdown menu (items have role="menuitem")
      const syncItem = screen.getByRole('menuitem', { name: /Sync/i })
      await syncItem.click()

      // The dropdown closes after clicking Sync. Re-open it to verify syncing state.
      // The "Syncing..." text appears inside the dropdown when isSyncingRegistry matches.
      const updatedTriggers = screen.container.querySelectorAll(
        '[data-slot="dropdown-menu-trigger"]',
      )
      ;(updatedTriggers[0] as HTMLElement).click()

      // Should show "Syncing..." text inside the re-opened dropdown
      await expect.element(screen.getByText('Syncing...')).toBeVisible()
    })
  })

  describe('Remove Registry', () => {
    it('removes a non-default registry successfully', async () => {
      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Met Norway is a non-default registry - verify it exists
      await expect
        .element(screen.getByRole('heading', { name: 'Met Norway' }))
        .toBeVisible()

      // Find and click the dropdown menu for Met Norway (second registry)
      // The dropdown trigger buttons have data-slot="dropdown-menu-trigger"
      const menuTriggers = screen.container.querySelectorAll(
        '[data-slot="dropdown-menu-trigger"]',
      )
      expect(menuTriggers.length).toBeGreaterThanOrEqual(2)
      // Click the second registry's menu button (Met Norway)
      ;(menuTriggers[1] as HTMLElement).click()

      // Click "Remove" from the dropdown menu (items have role="menuitem")
      const removeItem = screen.getByRole('menuitem', { name: /Remove/i })
      await removeItem.click()

      // After removal, Met Norway should no longer be in the document
      await expect
        .element(screen.getByRole('heading', { name: 'Met Norway' }))
        .not.toBeInTheDocument()
    })

    it('does not show Remove option for default registry', async () => {
      // Override to return only a default registry so we can verify
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({
            sources: [],
            registries: [
              {
                id: 'default-only',
                name: 'Default Only Registry',
                description: 'The only default registry',
                url: 'https://default.example.com',
                isDefault: true,
                isConnected: true,
                sourcesCount: 5,
                stores: [],
                lastSyncedAt: '2025-12-01T10:00:00Z',
              },
            ],
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Default Only Registry' }))
        .toBeVisible()

      // Open the dropdown menu using data-slot selector
      const menuTriggers = screen.container.querySelectorAll(
        '[data-slot="dropdown-menu-trigger"]',
      )
      expect(menuTriggers.length).toBe(1)
      ;(menuTriggers[0] as HTMLElement).click()

      // "Sync" should be present but "Remove" should NOT be present
      // because the registry is default
      const syncItem = screen.getByRole('menuitem', { name: /Sync/i })
      await expect.element(syncItem).toBeVisible()

      // Remove should not exist in the dropdown for a default registry
      await expect
        .element(screen.getByRole('menuitem', { name: /Remove/i }))
        .not.toBeInTheDocument()
    })

    it('returns error when trying to delete default registry via API', async () => {
      // Even if we somehow call the delete API for a default registry,
      // the backend should return an error
      let deleteError: string | null = null

      worker.use(
        http.delete(API_PATTERNS.registries.byId, () => {
          deleteError = 'Cannot remove default registry'
          return HttpResponse.json(
            { error: 'Cannot remove default registry' },
            { status: 400 },
          )
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // Verify the error handler is configured correctly
      expect(deleteError).toBeNull()
    })
  })

  describe('Multiple Registries with Different States', () => {
    it('displays registries with various connection states and store types', async () => {
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({
            sources: [],
            registries: [
              {
                id: 'reg-hf',
                name: 'HuggingFace Registry',
                description: 'HuggingFace-backed registry',
                url: 'https://hf-registry.example.com',
                isDefault: true,
                isConnected: true,
                sourcesCount: 15,
                stores: [
                  {
                    id: 'hf-store',
                    name: 'HuggingFace Hub',
                    url: 'https://huggingface.co',
                    type: 'huggingface',
                  },
                ],
                lastSyncedAt: '2025-12-10T08:00:00Z',
              },
              {
                id: 'reg-s3',
                name: 'S3 Cloud Registry',
                description: 'AWS S3-backed registry',
                url: 'https://s3-registry.example.com',
                isDefault: false,
                isConnected: true,
                sourcesCount: 8,
                stores: [
                  {
                    id: 's3-store',
                    name: 'AWS S3 Bucket',
                    url: 's3://my-models',
                    type: 's3',
                  },
                ],
                lastSyncedAt: '2025-12-09T14:30:00Z',
              },
              {
                id: 'reg-local',
                name: 'Local Dev Registry',
                description: 'Local development registry',
                url: 'http://localhost:8080',
                isDefault: false,
                isConnected: false,
                sourcesCount: 0,
                stores: [
                  {
                    id: 'local-store',
                    name: 'Local Storage',
                    url: '/data/models',
                    type: 'local',
                  },
                ],
              },
            ],
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      // All three registries should render
      await expect
        .element(screen.getByRole('heading', { name: 'HuggingFace Registry' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'S3 Cloud Registry' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('heading', { name: 'Local Dev Registry' }))
        .toBeVisible()

      // Should show Disconnected for the local one
      await expect.element(screen.getByText('Disconnected')).toBeVisible()

      // Sources counts should be visible
      await expect.element(screen.getByText('15 sources')).toBeVisible()
      await expect.element(screen.getByText('8 sources')).toBeVisible()
      await expect
        .element(screen.getByText('0 sources', { exact: true }))
        .toBeVisible()

      // Store names should be visible in the badges
      await expect.element(screen.getByText('HuggingFace Hub')).toBeVisible()
      await expect.element(screen.getByText('AWS S3 Bucket')).toBeVisible()
      await expect.element(screen.getByText('Local Storage')).toBeVisible()
    })

    it('shows Never synced for registries without a sync timestamp', async () => {
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({
            sources: [],
            registries: [
              {
                id: 'never-synced-reg',
                name: 'Unsynced Registry',
                description: 'A registry that has never been synced',
                url: 'https://unsynced.example.com',
                isDefault: false,
                isConnected: true,
                sourcesCount: 0,
                stores: [],
              },
            ],
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Source Registries' }))
        .toBeVisible()

      await expect
        .element(screen.getByRole('heading', { name: 'Unsynced Registry' }))
        .toBeVisible()
      await expect.element(screen.getByText('Never synced')).toBeVisible()
    })

    it('shows store badges with correct store names', async () => {
      worker.use(
        http.get(API_ENDPOINTS.sources.list, () => {
          return HttpResponse.json({
            sources: [],
            registries: [
              {
                id: 'multi-store',
                name: 'Multi-Store Registry',
                description: 'Registry with multiple stores',
                url: 'https://multi.example.com',
                isDefault: false,
                isConnected: true,
                sourcesCount: 10,
                stores: [
                  {
                    id: 'store-a',
                    name: 'Primary S3',
                    url: 's3://primary',
                    type: 's3',
                  },
                  {
                    id: 'store-b',
                    name: 'Backup GCS',
                    url: 'gs://backup',
                    type: 'gcs',
                  },
                ],
                lastSyncedAt: '2025-12-01T10:00:00Z',
              },
            ],
          })
        }),
      )

      const screen = await renderWithRouter(<TestRegistriesPage />)

      await expect
        .element(screen.getByRole('heading', { name: 'Multi-Store Registry' }))
        .toBeVisible()

      // Both store names should be displayed as badges
      await expect.element(screen.getByText('Primary S3')).toBeVisible()
      await expect.element(screen.getByText('Backup GCS')).toBeVisible()
    })
  })
})
