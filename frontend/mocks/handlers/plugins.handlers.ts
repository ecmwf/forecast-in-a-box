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
 * MSW Handlers for Plugin API
 *
 * These handlers match the new backend API:
 * - GET /api/v1/plugin/list
 * - POST /api/v1/plugin/install
 * - POST /api/v1/plugin/uninstall
 * - POST /api/v1/plugin/update
 * - POST /api/v1/plugin/settings
 */

import { HttpResponse, delay, http } from 'msw'
import { getMutablePluginListing } from '../data/plugins.data'
import type {
  PluginCompositeId,
  PluginDetail,
  PluginListing,
  PluginSettingsUpdate,
} from '@/api/types/plugins.types'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mutable copy for state changes
const pluginsState: PluginListing = getMutablePluginListing()

/**
 * Tracks how many catalogue requests should return 503 to simulate
 * the backend behaviour where the catalogue is temporarily unavailable
 * while plugins are reloading after an install/uninstall/update.
 */
let catalogueUnavailableCount = 0

/**
 * Signal that the next N catalogue requests should return 503.
 * Called by plugin mutation handlers to replicate real backend behaviour.
 */
export function setCatalogueUnavailable(count: number = 1): void {
  catalogueUnavailableCount = count
}

/**
 * Check and consume one 503 token. Returns true if the catalogue
 * should respond with 503 for this request.
 */
export function consumeCatalogueUnavailable(): boolean {
  if (catalogueUnavailableCount > 0) {
    catalogueUnavailableCount--
    return true
  }
  return false
}

/**
 * Reset handler-scoped state between tests. Without this, a queued 503
 * token from test A's install/update mutation can unexpectedly fire on
 * test B's first catalogue fetch. Called from `tests/setup.ts` in a
 * global `afterEach`.
 */
export function resetPluginsHandlerState(): void {
  catalogueUnavailableCount = 0
}

/**
 * Helper to create a Python repr format plugin key
 */
function createPluginKey(store: string, local: string): string {
  return `store='${store}' local='${local}'`
}

/**
 * Get current datetime in backend format: "YYYY-MM-DDTHH:MM:SS+00:00"
 */
function getCurrentDatetime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

export const pluginsHandlers = [
  // GET /api/v1/plugin/list
  http.get(API_ENDPOINTS.plugin.list, async () => {
    await delay(300)

    return HttpResponse.json(pluginsState)
  }),

  // POST /api/v1/plugin/install
  http.post(API_ENDPOINTS.plugin.install, async ({ request }) => {
    await delay(800)
    const body = (await request.json()) as PluginCompositeId

    const key = createPluginKey(body.store, body.local)
    const plugin = pluginsState.plugins[key] as PluginDetail | undefined

    if (!plugin) {
      return new HttpResponse(
        JSON.stringify({
          detail: `Plugin ${body.store}:${body.local} not found`,
        }),
        { status: 404 },
      )
    }

    if (plugin.install_data !== null) {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin is already installed' }),
        { status: 400 },
      )
    }

    const newVersion = plugin.generic_data.remote_info?.version ?? '1.0.0'
    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      install_data: {
        local_version: newVersion,
        update_datetime: getCurrentDatetime(),
        install_errors: [],
      },
      settings_data: {
        isEnabled: true,
        excluded_templates: [],
        included_templates: [],
        glyph_remapping: {},
      },
      load_errors: [],
    }

    // Simulate backend reload: catalogue will 503 once while plugins restart
    setCatalogueUnavailable(1)

    return HttpResponse.json({ success: true })
  }),

  // POST /api/v1/plugin/uninstall
  http.post(API_ENDPOINTS.plugin.uninstall, async ({ request }) => {
    await delay(500)
    const body = (await request.json()) as PluginCompositeId

    const key = createPluginKey(body.store, body.local)
    const plugin = pluginsState.plugins[key] as PluginDetail | undefined

    if (!plugin) {
      return new HttpResponse(
        JSON.stringify({
          detail: `Plugin ${body.store}:${body.local} not found`,
        }),
        { status: 404 },
      )
    }

    if (plugin.install_data === null) {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin is not installed' }),
        { status: 400 },
      )
    }

    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      install_data: null,
      settings_data: null,
      load_errors: [],
    }

    // Simulate backend reload: catalogue will 503 once while plugins restart
    setCatalogueUnavailable(1)

    return HttpResponse.json({ success: true })
  }),

  // POST /api/v1/plugin/update
  http.post(API_ENDPOINTS.plugin.update, async ({ request }) => {
    await delay(1000)
    const body = (await request.json()) as PluginCompositeId

    const key = createPluginKey(body.store, body.local)
    const plugin = pluginsState.plugins[key] as PluginDetail | undefined

    if (!plugin) {
      return new HttpResponse(
        JSON.stringify({
          detail: `Plugin ${body.store}:${body.local} not found`,
        }),
        { status: 404 },
      )
    }

    if (plugin.install_data === null) {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin is not installed' }),
        { status: 400 },
      )
    }

    const newVersion = plugin.generic_data.remote_info?.version
    if (!newVersion || newVersion === plugin.install_data.local_version) {
      return new HttpResponse(
        JSON.stringify({ detail: 'No update available' }),
        { status: 400 },
      )
    }

    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      install_data: {
        ...plugin.install_data,
        local_version: newVersion,
        update_datetime: getCurrentDatetime(),
      },
      load_errors: [],
    }

    // Simulate backend reload: catalogue will 503 once while plugins restart
    setCatalogueUnavailable(1)

    return HttpResponse.json({ success: true })
  }),

  // POST /api/v1/plugin/settings
  http.post(API_ENDPOINTS.plugin.settings, async ({ request }) => {
    await delay(300)
    const body = (await request.json()) as {
      pluginCompositeId: PluginCompositeId
    } & PluginSettingsUpdate
    const { pluginCompositeId, isEnabled } = body

    const key = createPluginKey(
      pluginCompositeId.store,
      pluginCompositeId.local,
    )
    const plugin = pluginsState.plugins[key] as PluginDetail | undefined

    if (!plugin) {
      return new HttpResponse(
        JSON.stringify({
          detail: `Plugin ${pluginCompositeId.store}:${pluginCompositeId.local} not found`,
        }),
        { status: 404 },
      )
    }

    if (plugin.install_data === null) {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin must be installed first' }),
        { status: 400 },
      )
    }

    // Update plugin state if isEnabled was provided
    if (isEnabled !== undefined && plugin.settings_data !== null) {
      pluginsState.plugins[key] = {
        ...plugin,
        settings_data: {
          ...plugin.settings_data,
          isEnabled,
        },
      }
    }

    return HttpResponse.json({ success: true })
  }),

  // GET /api/v1/plugin/templateExampleValues
  http.get(API_ENDPOINTS.plugin.templateExampleValues, async ({ request }) => {
    await delay(200)
    const url = new URL(request.url)
    const displayName = url.searchParams.get('displayName')

    // Matches the 'template-basic-map' blueprint fixture in fable.handlers.ts
    if (displayName !== 'testBasic') {
      return new HttpResponse(
        JSON.stringify({ detail: `Template ${displayName} not found` }),
        { status: 404 },
      )
    }

    return HttpResponse.json({
      example_values: {
        block_source_1: { base_time: '2026-07-01T00:00:00' },
      },
      example_glyphs: { leadtime: '48' },
    })
  }),
]
