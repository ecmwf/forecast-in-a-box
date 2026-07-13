/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/../mocks/browser'
import type {
  PluginCompositeId,
  PluginListing,
  PluginSettingsUpdate,
} from '@/api/types/plugins.types'
import {
  getPluginList,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  updatePluginSettings,
} from '@/api/endpoints/plugins'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock the env module
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

/**
 * Helper to create plugin composite ID
 */
function pluginId(store: string, local: string): PluginCompositeId {
  return { store, local }
}

/**
 * Helper to create a Python repr format plugin key
 */
function createPluginKey(store: string, local: string): string {
  return `store='${store}' local='${local}'`
}

describe('getPluginList', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches plugin list successfully', async () => {
    const mockResponse: PluginListing = {
      plugins: {
        [createPluginKey('ecmwf', 'anemoi-inference')]: {
          generic_data: {
            store_info: {
              pip_source: 'anemoi-inference',
              module_name: 'anemoi_inference',
              display_title: 'Anemoi Inference',
              display_description: 'ML inference engine',
              display_author: 'ECMWF',
              comment: '',
            },
            remote_info: { version: '1.0.0' },
          },
          install_data: {
            local_version: '1.0.0',
            update_datetime: '2025-01-15T00:00:00+00:00',
            install_errors: [],
          },
          settings_data: {
            isEnabled: true,
            excluded_templates: [],
            included_templates: [],
            glyph_remapping: {},
          },
          load_errors: [],
        },
        [createPluginKey('ecmwf', 'storm-tracker')]: {
          generic_data: {
            store_info: {
              pip_source: 'storm-tracker',
              module_name: 'storm_tracker',
              display_title: 'Storm Tracker',
              display_description: 'Track severe weather',
              display_author: 'ECMWF',
              comment: 'New plugin!',
            },
            remote_info: { version: '2.0.0' },
          },
          install_data: null,
          settings_data: null,
          load_errors: [],
        },
      },
    }

    worker.use(
      http.get(API_ENDPOINTS.plugin.list, () => {
        return HttpResponse.json(mockResponse)
      }),
    )

    const result = await getPluginList()
    expect(result.plugins).toBeDefined()
    expect(Object.keys(result.plugins)).toHaveLength(2)
  })
})

describe('installPlugin', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('installs plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'storm-tracker')

    worker.use(
      http.post(API_ENDPOINTS.plugin.install, async ({ request }) => {
        const body = (await request.json()) as PluginCompositeId
        expect(body.store).toBe('ecmwf')
        expect(body.local).toBe('storm-tracker')
        return HttpResponse.json({ success: true })
      }),
    )

    await installPlugin(testPluginId)
    // If we get here without error, the test passes
  })
})

describe('uninstallPlugin', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('uninstalls plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')

    worker.use(
      http.post(API_ENDPOINTS.plugin.uninstall, async ({ request }) => {
        const body = (await request.json()) as PluginCompositeId
        expect(body.store).toBe('ecmwf')
        expect(body.local).toBe('anemoi-inference')
        return HttpResponse.json({ success: true })
      }),
    )

    await uninstallPlugin(testPluginId)
    // If we get here without error, the test passes
  })
})

describe('updatePluginSettings', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  type SettingsBody = {
    pluginCompositeId: PluginCompositeId
  } & PluginSettingsUpdate

  it('enables plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')
    let receivedIsEnabled: boolean | undefined = undefined

    worker.use(
      http.post(API_ENDPOINTS.plugin.settings, async ({ request }) => {
        const body = (await request.json()) as SettingsBody
        expect(body.pluginCompositeId.store).toBe('ecmwf')
        expect(body.pluginCompositeId.local).toBe('anemoi-inference')
        receivedIsEnabled = body.isEnabled
        return HttpResponse.json({ success: true })
      }),
    )

    await updatePluginSettings(testPluginId, { isEnabled: true })
    expect(receivedIsEnabled).toBe(true)
  })

  it('disables plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')
    let receivedIsEnabled: boolean | undefined = undefined

    worker.use(
      http.post(API_ENDPOINTS.plugin.settings, async ({ request }) => {
        const body = (await request.json()) as SettingsBody
        receivedIsEnabled = body.isEnabled
        return HttpResponse.json({ success: true })
      }),
    )

    await updatePluginSettings(testPluginId, { isEnabled: false })
    expect(receivedIsEnabled).toBe(false)
  })

  it('sends template exclusions and glyph remapping, omitting unset fields', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')
    let receivedBody: SettingsBody | undefined = undefined

    worker.use(
      http.post(API_ENDPOINTS.plugin.settings, async ({ request }) => {
        receivedBody = (await request.json()) as SettingsBody
        return HttpResponse.json({ success: true })
      }),
    )

    await updatePluginSettings(testPluginId, {
      excluded_templates: ['Broken Template'],
      glyph_remapping: { old_name: 'new_name' },
    })
    expect(receivedBody).toEqual({
      pluginCompositeId: testPluginId,
      excluded_templates: ['Broken Template'],
      glyph_remapping: { old_name: 'new_name' },
    })
  })
})

describe('updatePlugin', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('updates plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')

    worker.use(
      http.post(API_ENDPOINTS.plugin.update, async ({ request }) => {
        const body = (await request.json()) as PluginCompositeId
        expect(body.store).toBe('ecmwf')
        expect(body.local).toBe('anemoi-inference')
        return HttpResponse.json({ success: true })
      }),
    )

    await updatePlugin(testPluginId)
    // If we get here without error, the test passes
  })
})

describe('getTemplateExampleValues', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches example values with store/local/displayName query params', async () => {
    const { getTemplateExampleValues } = await import('@/api/endpoints/plugins')
    let receivedParams: Record<string, string | null> = {}

    worker.use(
      http.get(API_ENDPOINTS.plugin.templateExampleValues, ({ request }) => {
        const url = new URL(request.url)
        receivedParams = {
          store: url.searchParams.get('store'),
          local: url.searchParams.get('local'),
          displayName: url.searchParams.get('displayName'),
        }
        return HttpResponse.json({
          example_values: {
            block_1: { area: { example_value: '[-10, 40, 10, 60]' } },
          },
          example_glyphs: { leadtime: { example_value: '48' } },
        })
      }),
    )

    const result = await getTemplateExampleValues(
      { store: 'local', local: 'plugin-test' },
      'testBasic',
    )
    expect(receivedParams).toEqual({
      store: 'local',
      local: 'plugin-test',
      displayName: 'testBasic',
    })
    expect(result.example_values.block_1).toEqual({
      area: { example_value: '[-10, 40, 10, 60]' },
    })
    expect(result.example_glyphs).toEqual({ leadtime: { example_value: '48' } })
  })
})
