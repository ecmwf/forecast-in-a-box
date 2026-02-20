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
 * These handlers match the new backend API exactly:
 * - GET /api/v1/plugin/status
 * - GET /api/v1/plugin/details
 * - POST /api/v1/plugin/install
 * - POST /api/v1/plugin/uninstall
 * - POST /api/v1/plugin/update
 * - POST /api/v1/plugin/modifyEnabled
 */

import { HttpResponse, delay, http } from 'msw'
import { getMutablePluginListing } from '../data/plugins.data'
import type {
  PluginCompositeId,
  PluginDetail,
  PluginListing,
  PluginsStatus,
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
 * Helper to create a Python repr format plugin key
 */
function createPluginKey(store: string, local: string): string {
  return `store='${store}' local='${local}'`
}

/**
 * Get current date in backend format
 */
function getCurrentDate(): string {
  const now = new Date()
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
}

export const pluginsHandlers = [
  // GET /api/v1/plugin/status
  http.get(API_ENDPOINTS.plugin.status, async () => {
    await delay(200)

    // Build status response from current state
    const status: PluginsStatus = {
      updater_status: 'idle',
      plugin_errors: {},
      plugin_versions: {},
      plugin_updatedate: {},
    }

    for (const [key, detail] of Object.entries(pluginsState.plugins)) {
      if (detail.status === 'errored' && detail.errored_detail) {
        status.plugin_errors[key] = detail.errored_detail
      }
      if (detail.loaded_version) {
        status.plugin_versions[key] = detail.loaded_version
      }
      if (detail.update_date) {
        status.plugin_updatedate[key] = detail.update_date
      }
    }

    return HttpResponse.json(status)
  }),

  // GET /api/v1/plugin/details
  http.get(API_ENDPOINTS.plugin.details, async ({ request }) => {
    await delay(300)

    // Check for forceRefresh query param (optional)
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.get('forceRefresh') === 'true'

    if (forceRefresh) {
      // Simulate refresh - in real backend this would re-fetch from PyPI
      await delay(500)
    }

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

    if (plugin.status !== 'available') {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin is already installed' }),
        { status: 400 },
      )
    }

    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      status: 'loaded',
      loaded_version: plugin.remote_info?.version ?? '1.0.0',
      update_date: getCurrentDate(),
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

    if (plugin.status === 'available') {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin is not installed' }),
        { status: 400 },
      )
    }

    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      status: 'available',
      loaded_version: null,
      update_date: null,
      errored_detail: null,
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

    if (plugin.status === 'available') {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin is not installed' }),
        { status: 400 },
      )
    }

    const newVersion = plugin.remote_info?.version
    if (!newVersion || newVersion === plugin.loaded_version) {
      return new HttpResponse(
        JSON.stringify({ detail: 'No update available' }),
        { status: 400 },
      )
    }

    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      status: 'loaded',
      loaded_version: newVersion,
      update_date: getCurrentDate(),
      errored_detail: null,
    }

    // Simulate backend reload: catalogue will 503 once while plugins restart
    setCatalogueUnavailable(1)

    return HttpResponse.json({ success: true })
  }),

  // POST /api/v1/plugin/modifyEnabled
  http.post(API_ENDPOINTS.plugin.modifyEnabled, async ({ request }) => {
    await delay(300)
    const url = new URL(request.url)
    const isEnabled = url.searchParams.get('isEnabled') === 'true'
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

    if (plugin.status === 'available') {
      return new HttpResponse(
        JSON.stringify({ detail: 'Plugin must be installed first' }),
        { status: 400 },
      )
    }

    // Update plugin state
    pluginsState.plugins[key] = {
      ...plugin,
      status: isEnabled ? 'loaded' : 'disabled',
      errored_detail: isEnabled ? null : plugin.errored_detail,
    }

    return HttpResponse.json({ success: true })
  }),
]
