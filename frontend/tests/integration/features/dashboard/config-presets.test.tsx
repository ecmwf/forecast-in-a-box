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
import { userEvent } from 'vitest/browser'
import { renderWithRouter } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { ConfigPresetsSection } from '@/features/dashboard/components/ConfigPresetsSection'
import { PresetsPage } from '@/features/dashboard/components/PresetsPage'
import { API_ENDPOINTS } from '@/api/endpoints'
import { ToastProvider } from '@/providers/ToastProvider'
import { ONEOFF_TAG } from '@/lib/system-tags'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Wire format for a blueprint list item as returned by the backend.
// Differs from the parsed `BlueprintListItem` type: `tags` are objects here
// but are transformed to strings by the Zod schema before reaching the app.
interface WireBlueprint {
  blueprint_id: string
  version: number
  display_name: string | null
  display_description: string | null
  tags: Array<{ key: string; value: string }> | null
  source: string | null
  created_by: string | null
}

const mockBlueprints: Array<WireBlueprint> = [
  {
    blueprint_id: 'bp-001',
    version: 1,
    display_name: 'European Forecast',
    display_description: 'Standard European config',
    tags: [
      { key: 'prod', value: '' },
      { key: 'europe', value: '' },
    ],
    source: 'user_defined',
    created_by: null,
  },
  {
    blueprint_id: 'bp-002',
    version: 2,
    display_name: 'Test Config',
    display_description: null,
    tags: null,
    source: 'user_defined',
    created_by: null,
  },
  {
    blueprint_id: 'bp-003',
    version: 1,
    display_name: 'Global Forecast',
    display_description: 'Full global run',
    tags: [{ key: 'global', value: '' }],
    source: 'user_defined',
    created_by: null,
  },
]

function useBlueprintListHandler(
  blueprints: Array<WireBlueprint> = mockBlueprints,
) {
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

const mockTemplates: Array<WireBlueprint> = [
  {
    blueprint_id: 'tpl-001',
    version: 1,
    display_name: 'Fast Map',
    display_description: 'Ready-made starting point',
    tags: null,
    source: 'plugin_template',
    created_by: 'local:plugin-test',
  },
]

/** List handler that honours the ?source= filter, like the real backend. */
function useSourceAwareListHandler(all: Array<WireBlueprint>) {
  worker.use(
    http.get(API_ENDPOINTS.fable.list, ({ request }) => {
      const source = new URL(request.url).searchParams.get('source')
      const blueprints = source ? all.filter((b) => b.source === source) : all
      return HttpResponse.json({
        blueprints,
        total: blueprints.length,
        page: 1,
        page_size: 50,
      })
    }),
  )
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
      source: 'user_defined',
      created_by: null,
    }))
    useBlueprintListHandler(manyBlueprints)

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect
      .element(screen.getByText('My Configuration Presets'))
      .toBeVisible()
  })

  it('excludes one-off runs and plugin templates from the presets list', async () => {
    useBlueprintListHandler([
      {
        blueprint_id: 'bp-saved',
        version: 1,
        display_name: 'Saved Config',
        display_description: null,
        tags: [{ key: 'prod', value: '' }],
        source: 'user_defined',
        created_by: null,
      },
      {
        blueprint_id: 'bp-run',
        version: 1,
        display_name: 'One-off Run',
        display_description: null,
        tags: [{ key: ONEOFF_TAG, value: '' }],
        source: 'user_defined',
        created_by: null,
      },
      {
        blueprint_id: 'bp-template',
        version: 1,
        display_name: 'Plugin Template',
        display_description: null,
        tags: null,
        source: 'plugin_template',
        created_by: null,
      },
    ])

    const screen = await renderWithRouter(<ConfigPresetsSection />)

    await expect.element(screen.getByText('Saved Config')).toBeVisible()
    await expect
      .element(screen.getByText('One-off Run'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Plugin Template'))
      .not.toBeInTheDocument()
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

    const searchInput = screen.getByPlaceholder(
      'Search or filter, e.g. tag:production',
    )
    await expect.element(searchInput).toBeVisible()
  })

  it('shows empty filtered state when search matches nothing', async () => {
    useBlueprintListHandler()

    const screen = await renderWithRouter(<PresetsPage />)

    const searchInput = screen.getByPlaceholder(
      'Search or filter, e.g. tag:production',
    )
    await searchInput.fill('nonexistent query')
    await userEvent.keyboard('{Enter}')

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

describe('PresetsPage — Templates tab', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('lists plugin templates with chip, plugin label and a Use template action', async () => {
    useSourceAwareListHandler([...mockBlueprints, ...mockTemplates])

    const screen = await renderWithRouter(<PresetsPage />)

    await screen.getByRole('button', { name: 'Templates' }).click()

    await expect.element(screen.getByText('Fast Map')).toBeVisible()
    await expect
      .element(screen.getByText('Template', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('From plugin: plugin-test'))
      .toBeVisible()
    await expect.element(screen.getByText('Use template')).toBeVisible()
    // User presets don't render on the Templates tab
    await expect
      .element(screen.getByText('European Forecast'))
      .not.toBeInTheDocument()
  })

  it('does not leak templates into the All tab', async () => {
    useSourceAwareListHandler([...mockBlueprints, ...mockTemplates])

    const screen = await renderWithRouter(<PresetsPage />)

    await expect.element(screen.getByText('European Forecast')).toBeVisible()
    await expect.element(screen.getByText('Fast Map')).not.toBeInTheDocument()
  })
})

describe('PresetsPage — template lineage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows a "Based on" hint for presets forked from a template', async () => {
    useSourceAwareListHandler(mockBlueprints.slice(0, 1))
    worker.use(
      http.get(API_ENDPOINTS.fable.get, ({ request }) => {
        const id = new URL(request.url).searchParams.get('blueprint_id')
        if (id === 'bp-001') {
          return HttpResponse.json({
            blueprint_id: 'bp-001',
            version: 1,
            builder: { blocks: {} },
            display_name: 'European Forecast',
            display_description: null,
            tags: [],
            parent_id: 'tpl-001',
          })
        }
        if (id === 'tpl-001') {
          return HttpResponse.json({
            blueprint_id: 'tpl-001',
            version: 1,
            builder: { blocks: {} },
            display_name: 'Fast Map',
            display_description: null,
            tags: [],
            parent_id: null,
          })
        }
        return HttpResponse.json({ message: 'not found' }, { status: 404 })
      }),
    )

    const screen = await renderWithRouter(<PresetsPage />)

    await expect.element(screen.getByText('European Forecast')).toBeVisible()
    await expect.element(screen.getByText(/Based on: Fast Map/)).toBeVisible()
  })
})

describe('PresetsPage — delete preset', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows a success toast and no refresh error after deleting', async () => {
    let list = mockBlueprints.slice(0, 1)
    worker.use(
      http.get(API_ENDPOINTS.fable.list, () =>
        HttpResponse.json({
          blueprints: list,
          total: list.length,
          page: 1,
          page_size: 50,
        }),
      ),
      http.get(API_ENDPOINTS.fable.get, ({ request }) => {
        const id = new URL(request.url).searchParams.get('blueprint_id')
        if (id === 'bp-001' && list.length > 0) {
          return HttpResponse.json({
            blueprint_id: 'bp-001',
            version: 1,
            builder: { blocks: {} },
            display_name: 'European Forecast',
            display_description: null,
            tags: [],
            parent_id: null,
          })
        }
        return HttpResponse.json(
          { detail: `Blueprint '${id}' not found` },
          { status: 404 },
        )
      }),
      http.post(API_ENDPOINTS.fable.delete, () => {
        list = []
        return HttpResponse.json({ success: true })
      }),
    )

    const screen = await renderWithRouter(
      <ToastProvider>
        <PresetsPage />
      </ToastProvider>,
    )
    await expect.element(screen.getByText('European Forecast')).toBeVisible()

    await screen.getByRole('button', { name: 'More options' }).click()
    await screen.getByText('Delete').click()

    await expect.element(screen.getByText('Preset deleted')).toBeVisible()
    await expect
      .element(screen.getByText('European Forecast'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText(/Failed to refresh data/))
      .not.toBeInTheDocument()
  })
})
