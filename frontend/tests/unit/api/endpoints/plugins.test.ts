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
  PluginsStatus,
} from '@/api/types/plugins.types'
import {
  getPluginDetails,
  getPluginStatus,
  installPlugin,
  modifyPluginEnabled,
  uninstallPlugin,
  updatePlugin,
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

describe('getPluginStatus', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches plugin status successfully', async () => {
    const mockResponse: PluginsStatus = {
      updater_status: 'idle',
      plugin_errors: {
        [createPluginKey('ecmwf', 'legacy-viz')]:
          'Failed to load: incompatible version',
      },
      plugin_versions: {
        [createPluginKey('ecmwf', 'anemoi-inference')]: '1.0.0',
      },
      plugin_updatedate: {
        [createPluginKey('ecmwf', 'anemoi-inference')]: '2025/01/15',
      },
    }

    worker.use(
      http.get(API_ENDPOINTS.plugin.status, () => {
        return HttpResponse.json(mockResponse)
      }),
    )

    const result = await getPluginStatus()
    expect(result.updater_status).toBe('idle')
    expect(result.plugin_errors).toBeDefined()
    expect(result.plugin_versions).toBeDefined()
  })
})

describe('getPluginDetails', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches plugin details successfully', async () => {
    const mockResponse: PluginListing = {
      plugins: {
        [createPluginKey('ecmwf', 'anemoi-inference')]: {
          status: 'loaded',
          store_info: {
            pip_source: 'anemoi-inference',
            module_name: 'anemoi_inference',
            display_title: 'Anemoi Inference',
            display_description: 'ML inference engine',
            display_author: 'ECMWF',
            comment: '',
          },
          remote_info: { version: '1.0.0' },
          errored_detail: null,
          loaded_version: '1.0.0',
          update_date: '2025/01/15',
        },
        [createPluginKey('ecmwf', 'storm-tracker')]: {
          status: 'available',
          store_info: {
            pip_source: 'storm-tracker',
            module_name: 'storm_tracker',
            display_title: 'Storm Tracker',
            display_description: 'Track severe weather',
            display_author: 'ECMWF',
            comment: 'New plugin!',
          },
          remote_info: { version: '2.0.0' },
          errored_detail: null,
          loaded_version: null,
          update_date: null,
        },
      },
    }

    worker.use(
      http.get(API_ENDPOINTS.plugin.details, () => {
        return HttpResponse.json(mockResponse)
      }),
    )

    const result = await getPluginDetails()
    expect(result.plugins).toBeDefined()
    expect(Object.keys(result.plugins)).toHaveLength(2)
  })

  it('passes forceRefresh parameter', async () => {
    let receivedForceRefresh = false

    worker.use(
      http.get(API_ENDPOINTS.plugin.details, ({ request }) => {
        const url = new URL(request.url)
        receivedForceRefresh = url.searchParams.get('forceRefresh') === 'true'
        return HttpResponse.json({ plugins: {} })
      }),
    )

    await getPluginDetails(true)
    expect(receivedForceRefresh).toBe(true)
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

describe('modifyPluginEnabled', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('enables plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')
    let receivedIsEnabled: string | null = null

    worker.use(
      http.post(API_ENDPOINTS.plugin.modifyEnabled, async ({ request }) => {
        const url = new URL(request.url)
        receivedIsEnabled = url.searchParams.get('isEnabled')
        const body = (await request.json()) as PluginCompositeId
        expect(body.store).toBe('ecmwf')
        expect(body.local).toBe('anemoi-inference')
        return HttpResponse.json({ success: true })
      }),
    )

    await modifyPluginEnabled(testPluginId, true)
    expect(receivedIsEnabled).toBe('true')
  })

  it('disables plugin successfully', async () => {
    const testPluginId = pluginId('ecmwf', 'anemoi-inference')
    let receivedIsEnabled: string | null = null

    worker.use(
      http.post(API_ENDPOINTS.plugin.modifyEnabled, ({ request }) => {
        const url = new URL(request.url)
        receivedIsEnabled = url.searchParams.get('isEnabled')
        return HttpResponse.json({ success: true })
      }),
    )

    await modifyPluginEnabled(testPluginId, false)
    expect(receivedIsEnabled).toBe('false')
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
