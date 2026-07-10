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
 * Plugins API Endpoints
 *
 * API functions for plugin management operations.
 * All endpoints match the backend API exactly.
 */

import type {
  PluginCompositeId,
  PluginListing,
  PluginSettingsUpdate,
  TemplateExampleValues,
} from '@/api/types/plugins.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  PluginListingSchema,
  TemplateExampleValuesSchema,
} from '@/api/types/plugins.types'

/**
 * Get all plugin details
 */
export async function getPluginList(): Promise<PluginListing> {
  return apiClient.get(API_ENDPOINTS.plugin.list, {
    schema: PluginListingSchema,
  })
}

/**
 * Install a plugin
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function installPlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.plugin.install, compositeId)
}

/**
 * Uninstall a plugin
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function uninstallPlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.plugin.uninstall, compositeId)
}

/**
 * Update a plugin to latest version
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function updatePlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.plugin.update, compositeId)
}

/**
 * Update plugin settings (enabled flag, template exclusions, glyph remapping)
 * @param compositeId - The plugin composite ID { store, local }
 * @param settings - Fields to change; omitted fields stay unchanged
 */
export async function updatePluginSettings(
  compositeId: PluginCompositeId,
  settings: PluginSettingsUpdate,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.plugin.settings, {
    pluginCompositeId: compositeId,
    ...settings,
  })
}

/**
 * Get example values/glyphs for a blueprint template from a loaded plugin
 * @param compositeId - The plugin composite ID { store, local }
 * @param displayName - The template's display name within the plugin
 */
export async function getTemplateExampleValues(
  compositeId: PluginCompositeId,
  displayName: string,
): Promise<TemplateExampleValues> {
  return apiClient.get(API_ENDPOINTS.plugin.templateExampleValues, {
    params: {
      store: compositeId.store,
      local: compositeId.local,
      displayName,
    },
    schema: TemplateExampleValuesSchema,
  })
}

/**
 * Enable a plugin (convenience wrapper for updatePluginSettings)
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function enablePlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await updatePluginSettings(compositeId, { isEnabled: true })
}

/**
 * Disable a plugin (convenience wrapper for updatePluginSettings)
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function disablePlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await updatePluginSettings(compositeId, { isEnabled: false })
}
