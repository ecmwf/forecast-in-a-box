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
  PluginsStatus,
} from '@/api/types/plugins.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  PluginListingSchema,
  PluginsStatusSchema,
} from '@/api/types/plugins.types'

/**
 * Get plugin system status
 */
export async function getPluginStatus(): Promise<PluginsStatus> {
  return apiClient.get(API_ENDPOINTS.plugin.status, {
    schema: PluginsStatusSchema,
  })
}

/**
 * Get all plugin details
 * @param forceRefresh - If true, forces a refresh from the backend
 */
export async function getPluginDetails(
  forceRefresh?: boolean,
): Promise<PluginListing> {
  return apiClient.get(API_ENDPOINTS.plugin.details, {
    params: forceRefresh ? { forceRefresh: 'true' } : undefined,
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
 * Modify plugin enabled state (enable or disable)
 * @param compositeId - The plugin composite ID { store, local }
 * @param isEnabled - Whether to enable (true) or disable (false) the plugin
 */
export async function modifyPluginEnabled(
  compositeId: PluginCompositeId,
  isEnabled: boolean,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.plugin.modifyEnabled, compositeId, {
    params: { isEnabled: String(isEnabled) },
  })
}

/**
 * Enable a plugin (convenience wrapper for modifyPluginEnabled)
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function enablePlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await modifyPluginEnabled(compositeId, true)
}

/**
 * Disable a plugin (convenience wrapper for modifyPluginEnabled)
 * @param compositeId - The plugin composite ID { store, local }
 */
export async function disablePlugin(
  compositeId: PluginCompositeId,
): Promise<void> {
  await modifyPluginEnabled(compositeId, false)
}
