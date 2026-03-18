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
 * Plugin Types and Schemas
 *
 * Type definitions and Zod schemas for plugin management API.
 * These types match the backend API exactly.
 */

import { z } from 'zod'

/**
 * Plugin composite ID - identifies a plugin by store and local name
 *
 * Backend format: { store: "ecmwf", local: "toy1" }
 * API key format: "store='ecmwf' local='toy1'" (Python repr format)
 */
export const PluginCompositeIdSchema = z.object({
  store: z.string(),
  local: z.string(),
})

export type PluginCompositeId = z.infer<typeof PluginCompositeIdSchema>

/**
 * Parse a plugin key from the API response format
 * Format: "store='ecmwf' local='toy1'" (Python repr format)
 */
export function parsePluginKey(key: string): PluginCompositeId {
  const storeMatch = key.match(/store='([^']+)'/)
  const localMatch = key.match(/local='([^']+)'/)
  return {
    store: storeMatch?.[1] ?? '',
    local: localMatch?.[1] ?? '',
  }
}

/**
 * Convert a PluginCompositeId to the API key format
 */
export function toPluginKey(id: PluginCompositeId): string {
  return `store='${id.store}' local='${id.local}'`
}

/**
 * Convert a PluginCompositeId to a display-friendly string
 */
export function toPluginDisplayId(id: PluginCompositeId): string {
  return `${id.store}/${id.local}`
}

/**
 * Encode a PluginCompositeId for use in URL path segments.
 * Format: "store--local" (e.g., "ecmwf--ecmwf-base")
 */
export function encodePluginId(id: PluginCompositeId): string {
  return `${id.store}--${id.local}`
}

/**
 * Decode a URL path segment back to a PluginCompositeId.
 * Expects "store--local" format.
 */
export function decodePluginId(encoded: string): PluginCompositeId {
  const separatorIndex = encoded.indexOf('--')
  if (separatorIndex === -1) {
    return { store: encoded, local: '' }
  }
  return {
    store: encoded.slice(0, separatorIndex),
    local: encoded.slice(separatorIndex + 2),
  }
}

/**
 * Plugin status values from backend
 *
 * - available: Plugin is in store but not installed
 * - disabled: Plugin is installed but disabled
 * - errored: Plugin encountered an error during load
 * - loaded: Plugin is installed and running
 */
export const pluginStatusValues = [
  'available',
  'disabled',
  'errored',
  'loaded',
] as const
export type PluginStatus = (typeof pluginStatusValues)[number]

/**
 * Plugin capability categories (derived from fable catalogue BlockKind)
 *
 * These are NOT provided by the plugin API directly, but are derived
 * from the fable catalogue by aggregating unique BlockFactory.kind values
 * across all factories provided by a plugin.
 */
export const pluginCapabilityValues = [
  'source',
  'transform',
  'product',
  'sink',
] as const
export type PluginCapability = (typeof pluginCapabilityValues)[number]

/**
 * Plugin store entry - info about a plugin from the store catalog
 */
export const PluginStoreEntrySchema = z.object({
  pip_source: z.string(),
  module_name: z.string(),
  display_title: z.string(),
  display_description: z.string(),
  display_author: z.string(),
  comment: z.string(),
})

export type PluginStoreEntry = z.infer<typeof PluginStoreEntrySchema>

/**
 * Plugin remote info - version info from PyPI
 */
export const PluginRemoteInfoSchema = z.object({
  version: z.string(),
})

export type PluginRemoteInfo = z.infer<typeof PluginRemoteInfoSchema>

/**
 * Plugin detail - full plugin information from backend
 */
export const PluginDetailSchema = z.object({
  status: z.enum(pluginStatusValues),
  store_info: PluginStoreEntrySchema.nullable(),
  remote_info: PluginRemoteInfoSchema.nullable(),
  errored_detail: z.string().nullable(),
  loaded_version: z.string().nullable(),
  update_date: z.string().nullable(), // "YYYY/MM/DD" format
})

export type PluginDetail = z.infer<typeof PluginDetailSchema>

/**
 * Plugin listing response - dict of plugins keyed by composite ID
 */
export const PluginListingSchema = z.object({
  plugins: z.record(z.string(), PluginDetailSchema),
})

export type PluginListing = z.infer<typeof PluginListingSchema>

/**
 * Plugin status response from /plugin/status endpoint
 */
export const PluginsStatusSchema = z.object({
  updater_status: z.string(),
  plugin_errors: z.record(z.string(), z.string()),
  plugin_versions: z.record(z.string(), z.string()),
  plugin_updatedate: z.record(z.string(), z.string()),
})

export type PluginsStatus = z.infer<typeof PluginsStatusSchema>

/**
 * UI-friendly plugin info (transformed from PluginDetail)
 *
 * This is what the UI components use. Transformed from backend format
 * with computed fields for easier rendering.
 */
export interface PluginInfo {
  /** Composite ID */
  id: PluginCompositeId
  /** Display ID for UI (e.g., "ecmwf/toy1") */
  displayId: string
  /** Display name from store_info.display_title */
  name: string
  /** Plugin description from store_info.display_description */
  description: string
  /** Author name from store_info.display_author */
  author: string
  /** Currently installed version (loaded_version) */
  version: string | null
  /** Latest available version (remote_info.version) */
  latestVersion: string | null
  /** FIAB version compatibility (optional, backend will provide later) */
  fiabCompatibility?: string
  /** Plugin capabilities - derived from fable catalogue */
  capabilities: Array<PluginCapability>
  /** Current status from backend */
  status: PluginStatus
  /** Whether plugin is enabled (loaded or errored) */
  isEnabled: boolean
  /** Whether plugin is installed (not available) */
  isInstalled: boolean
  /** Whether an update is available (latestVersion > version) */
  hasUpdate: boolean
  /** ISO date when last updated (from update_date) */
  updatedAt: string | null
  /** Error details if status is errored */
  errorDetail: string | null
  /** Store comment */
  comment: string | null
  /** Pip source for installation */
  pipSource: string | null
  /** Module name */
  moduleName: string | null
}

/**
 * Plugin stats for dashboard display
 */
export interface PluginsStats {
  installedCount: number
  loadedCount: number
  disabledCount: number
  erroredCount: number
  availableCount: number
  updatesAvailableCount: number
}

/**
 * Transform a PluginDetail to UI-friendly PluginInfo
 */
export function toPluginInfo(
  id: PluginCompositeId,
  detail: PluginDetail,
  capabilities: Array<PluginCapability> = [],
): PluginInfo {
  const isInstalled = detail.status !== 'available'
  const hasUpdate =
    isInstalled &&
    detail.loaded_version !== null &&
    detail.remote_info !== null &&
    detail.loaded_version !== detail.remote_info.version

  return {
    id,
    displayId: toPluginDisplayId(id),
    name: detail.store_info?.display_title ?? id.local,
    description: detail.store_info?.display_description ?? '',
    author: detail.store_info?.display_author ?? '',
    version: detail.loaded_version === 'unknown' ? null : detail.loaded_version,
    latestVersion: detail.remote_info?.version ?? null,
    capabilities,
    status: detail.status,
    isEnabled: detail.status === 'loaded' || detail.status === 'errored',
    isInstalled,
    hasUpdate,
    updatedAt: detail.update_date
      ? toValidDateOrNull(detail.update_date)
      : null,
    errorDetail: detail.errored_detail,
    comment: detail.store_info?.comment ?? null,
    pipSource: detail.store_info?.pip_source ?? null,
    moduleName: detail.store_info?.module_name ?? null,
  }
}

/**
 * Converts and validates a date string, returning null if unparseable.
 */
function toValidDateOrNull(dateStr: string): string | null {
  const converted = convertUpdateDate(dateStr)
  const date = new Date(converted)
  return isNaN(date.getTime()) ? null : converted
}

/**
 * Convert backend date format (YYYY/MM/DD) to ISO format
 */
function convertUpdateDate(dateStr: string): string {
  // Convert "YYYY/MM/DD" to ISO format
  const [year, month, day] = dateStr.split('/')
  if (year && month && day) {
    return `${year}-${month}-${day}T00:00:00Z`
  }
  return dateStr
}

/**
 * Transform PluginListing response to array of PluginInfo
 */
export function toPluginInfoList(
  listing: PluginListing,
  capabilitiesMap: Map<string, Array<PluginCapability>> = new Map(),
): Array<PluginInfo> {
  return Object.entries(listing.plugins).map(([key, detail]) => {
    const id = parsePluginKey(key)
    const displayId = toPluginDisplayId(id)
    const capabilities = capabilitiesMap.get(displayId) ?? []
    return toPluginInfo(id, detail, capabilities)
  })
}

/**
 * Calculate plugin stats from a list of PluginInfo
 */
export function calculatePluginStats(plugins: Array<PluginInfo>): PluginsStats {
  return {
    installedCount: plugins.filter((p) => p.isInstalled).length,
    loadedCount: plugins.filter((p) => p.status === 'loaded').length,
    disabledCount: plugins.filter((p) => p.status === 'disabled').length,
    erroredCount: plugins.filter((p) => p.status === 'errored').length,
    availableCount: plugins.filter((p) => p.status === 'available').length,
    updatesAvailableCount: plugins.filter((p) => p.hasUpdate).length,
  }
}
