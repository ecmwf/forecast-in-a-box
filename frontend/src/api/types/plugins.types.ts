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
 * Structured plugin diagnostic (backend PluginError).
 * source: install | load | template_ingest; severity: warning | error | critical.
 * Plain strings so new backend values don't fail parsing.
 */
export const PluginErrorSchema = z.object({
  source: z.string(),
  detail: z.string(),
  severity: z.string(),
})

export type PluginError = z.infer<typeof PluginErrorSchema>

/**
 * Flatten structured plugin errors to a display string, one detail per line
 */
export function pluginErrorsToText(errors: Array<PluginError>): string {
  return errors.map((e) => e.detail).join('\n')
}

/**
 * Plugin detail - full plugin information from backend
 */
export const PluginDetailSchema = z.object({
  status: z.enum(pluginStatusValues),
  store_info: PluginStoreEntrySchema.nullable(),
  remote_info: PluginRemoteInfoSchema.nullable(),
  errored_detail: z.array(PluginErrorSchema).nullable(),
  loaded_version: z.string().nullable(),
  update_datetime: z.string().nullable(), // UTC ISO with offset, e.g. "...+00:00"
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
  plugin_errors: z.record(z.string(), z.array(PluginErrorSchema)),
  plugin_versions: z.record(z.string(), z.string()),
  plugin_updatedatetime: z.record(z.string(), z.string()),
  plugin_enabled: z.record(z.string(), z.boolean()),
  plugin_excluded_templates: z.record(z.string(), z.array(z.string())),
  plugin_glyph_remapping: z.record(
    z.string(),
    z.record(z.string(), z.string()),
  ),
})

export type PluginsStatus = z.infer<typeof PluginsStatusSchema>

/**
 * Payload fields for POST /plugin/settings (backend PluginSettingsUpdateRequest).
 * Omitted fields leave the stored value unchanged; an empty list/dict clears it.
 */
export interface PluginSettingsUpdate {
  /** Enable or disable the plugin */
  isEnabled?: boolean
  /** Blueprint-template display names to exclude from ingestion */
  excluded_templates?: Array<string>
  /** Glyph rename map applied at template ingestion */
  glyph_remapping?: Record<string, string>
}

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
  /** Last-updated UTC ISO, tz-aware (from update_datetime) */
  updatedAt: string | null
  /** Structured diagnostics when the plugin has errors or warnings */
  errorDetail: Array<PluginError> | null
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
 * True when `remote` is a strictly newer release than `loaded`.
 * Compares numeric release segments only — pre-release suffixes are ignored,
 * and unparseable versions (e.g. the backend's "unknown" sentinel) are never newer.
 */
export function isNewerVersion(remote: string, loaded: string): boolean {
  const remoteSegments = parseReleaseSegments(remote)
  const loadedSegments = parseReleaseSegments(loaded)
  if (!remoteSegments || !loadedSegments) return false
  const length = Math.max(remoteSegments.length, loadedSegments.length)
  for (let i = 0; i < length; i++) {
    const r = remoteSegments[i] ?? 0
    const l = loadedSegments[i] ?? 0
    if (r !== l) return r > l
  }
  return false
}

function parseReleaseSegments(version: string): Array<number> | null {
  const release = version.trim().match(/^v?(\d+(?:\.\d+)*)/)?.[1]
  return release ? release.split('.').map(Number) : null
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
    isNewerVersion(detail.remote_info.version, detail.loaded_version)

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
    updatedAt: detail.update_datetime
      ? toUtcIsoOrNull(detail.update_datetime)
      : null,
    errorDetail: detail.errored_detail?.length ? detail.errored_detail : null,
    comment: detail.store_info?.comment ?? null,
    pipSource: detail.store_info?.pip_source ?? null,
    moduleName: detail.store_info?.module_name ?? null,
  }
}

/**
 * Normalize a backend UTC datetime for `new Date()`. Tz-aware values (e.g. a
 * `+00:00` offset) pass through; a bare value gets `Z` appended so it reads as
 * UTC, not local. Null if unparseable.
 */
function toUtcIsoOrNull(dateStr: string): string | null {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateStr)
    ? dateStr
    : `${dateStr}Z`
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized
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
