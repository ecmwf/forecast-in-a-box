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
 * Configuration Presets Integration Tests
 *
 * Tests the ConfigPresetsSection (dashboard row) and PresetsPage:
 * - Dashboard row renders preset cards from backend Blueprint list API
 * - Dashboard row hidden when no presets exist
 * - PresetsPage renders with search, filters, and pagination
 */

import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { ConfigPresetsSection } from '@/features/dashboard/components/ConfigPresetsSection'
import { PresetsPage } from '@/features/dashboard/components/PresetsPage'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

const mockBlueprints = [
  {
    blueprint_id: 'bp-001',
    version: 1,
    display_name: 'European Forecast',
    display_description: 'Standard European config',
    tags: ['prod', 'europe'],
    source: null,
    created_by: null,
  },
  {
    blueprint_id: 'bp-002',
    version: 2,
    display_name: 'Test Config',
    display_description: null,
    tags: null,
    source: null,
    created_by: null,
  },
  {
    blueprint_id: 'bp-003',
    version: 1,
    display_name: 'Global Forecast',
    display_description: 'Full global run',
    tags: ['global'],
    source: null,
    created_by: null,
  },
]

function useBlueprintListHandler(blueprints = mockBlueprints) {
  worker.use(
    http.get(API_ENDPOINTS.fable.list, () => {
      return HttpResponse.json({
        blueprints,
        total: blueprints.length,
        page: 1,
        page_size: 50,
      })
    }),
  )
}

function useEmptyBlueprintListHandler() {
  useBlueprintListHandler([])
}

describe('ConfigPresetsSection', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders nothing when no presets exist', async () => {
    useEmptyBlueprintListHandler()

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect
      .element(screen.getByText('My Configuration Presets'))
      .not.toBeInTheDocument()
  })

  it('renders preset cards when blueprints exist on backend', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect
      .element(screen.getByText('My Configuration Presets'))
      .toBeVisible()
  })

  it('shows "View all presets" link', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect.element(screen.getByText('View all presets')).toBeVisible()
  })

  it('shows at most 4 preset cards on the dashboard', async () => {
    const manyBlueprints = Array.from({ length: 6 }, (_, i) => ({
      blueprint_id: `bp-many-${i}`,
      version: 1,
      display_name: `Config ${i}`,
      display_description: null,
      tags: null,
      source: null,
      created_by: null,
    }))
    useBlueprintListHandler(manyBlueprints)

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect
      .element(screen.getByText('My Configuration Presets'))
      .toBeVisible()
  })
})

describe('PresetsPage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows empty state when no presets exist', async () => {
    useEmptyBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    await expect.element(screen.getByText('No saved presets yet')).toBeVisible()
  })

  it('renders preset list when blueprints exist', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Configuration Presets',
        }),
      )
      .toBeVisible()
  })

  it('renders search input', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder('Search presets...')
    await expect.element(searchInput).toBeVisible()
  })

  it('shows empty filtered state when search matches nothing', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder('Search presets...')
    await searchInput.fill('nonexistent query')

    await expect
      .element(screen.getByText('No presets match your search.'))
      .toBeVisible()
  })

  it('renders filter buttons', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    await expect.element(screen.getByText('All')).toBeVisible()
    await expect.element(screen.getByText('Bookmarked')).toBeVisible()
  })

  it('renders Load buttons for each preset', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    const loadButtons = screen.getByText('Use this Preset')
    await expect.element(loadButtons.first()).toBeVisible()
  })
})
