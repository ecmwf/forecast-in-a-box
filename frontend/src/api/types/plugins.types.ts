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

export type PluginErrorSeverity = 'warning' | 'error' | 'critical'

const SEVERITY_RANK: Record<PluginErrorSeverity, number> = {
  warning: 1,
  error: 2,
  critical: 3,
}

/** Unknown severity strings count as 'error' */
export function normalizePluginErrorSeverity(
  severity: string,
): PluginErrorSeverity {
  return severity in SEVERITY_RANK ? (severity as PluginErrorSeverity) : 'error'
}

/** Highest severity present, null for an empty list */
export function pluginErrorsMaxSeverity(
  errors: Array<PluginError>,
): PluginErrorSeverity | null {
  let max: PluginErrorSeverity | null = null
  for (const error of errors) {
    const severity = normalizePluginErrorSeverity(error.severity)
    if (!max || SEVERITY_RANK[severity] > SEVERITY_RANK[max]) {
      max = severity
    }
  }
  return max
}

/** The single visual state a plugin's status badge conveys. */
export type PluginBadgeKind =
  | 'loaded'
  | 'disabled'
  | 'warning'
  | 'errored'
  | 'update'
  | 'available'

/**
 * The one badge a plugin shows. Badge and status filter both derive from this,
 * so they can't drift. Precedence: disabled → update → warning → errored →
 * available → loaded.
 */
export function pluginBadgeKind(plugin: {
  status: PluginStatus
  isEnabled?: boolean
  hasUpdate?: boolean
  errorSeverity?: PluginErrorSeverity | null
}): PluginBadgeKind {
  // Disabled dominates — blocks stay out of the catalogue until re-enabled.
  // (Uninstalled 'available' plugins keep their own badge.)
  if (plugin.isEnabled === false && plugin.status !== 'available') {
    return 'disabled'
  }
  if (plugin.hasUpdate && plugin.status === 'loaded') return 'update'
  // Severity drives the badge, not status — a warning is amber whether the
  // plugin loaded or errored.
  if (plugin.errorSeverity === 'warning') return 'warning'
  if (plugin.status === 'errored') return 'errored'
  if (plugin.status === 'available') return 'available'
  return 'loaded'
}

/**
 * Generic plugin data - always present, regardless of install status
 */
export const PluginGenericDataSchema = z.object({
  store_info: PluginStoreEntrySchema.nullable(),
  remote_info: PluginRemoteInfoSchema.nullable(),
})

/**
 * Plugin install data - present when the plugin has a DB record (i.e. was installed)
 */
export const PluginInstallDataSchema = z.object({
  local_version: z.string(),
  update_datetime: z.string(), // UTC ISO with offset, e.g. "...+00:00"
  install_errors: z.array(PluginErrorSchema),
})

/**
 * Plugin install settings - present when install succeeded (no error/critical install errors)
 */
export const PluginInstallSettingsSchema = z.object({
  isEnabled: z.boolean(),
  excluded_templates: z.array(z.string()),
  included_templates: z.array(z.string()),
  glyph_remapping: z.record(z.string(), z.string()),
})

/**
 * Plugin detail - full plugin information from backend (GET /plugin/list)
 */
export const PluginDetailSchema = z.object({
  generic_data: PluginGenericDataSchema,
  install_data: PluginInstallDataSchema.nullable(),
  settings_data: PluginInstallSettingsSchema.nullable(),
  load_errors: z.array(PluginErrorSchema),
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
 * Derive the logical plugin status from the new nested PluginDetail structure.
 * - No install_data → not installed → available
 * - install_data present, settings_data absent → install failed → errored
 * - settings_data.isEnabled false → disabled
 * - settings_data.isEnabled true → loaded
 */
export function derivePluginStatus(detail: PluginDetail): PluginStatus {
  if (detail.install_data === null) return 'available'
  if (detail.settings_data === null) return 'errored'
  return detail.settings_data.isEnabled ? 'loaded' : 'disabled'
}

/**
 * Example input for a single parameter or glyph in a blueprint template.
 * The `example_value` is the actual string value; the other fields are UI metadata.
 */
export const BlueprintTemplateExampleInputSchema = z.object({
  example_value: z.string(),
  display_name: z.string().nullable().optional(),
  display_description: z.string().nullable().optional(),
  type_hint: z.string().nullable().optional(),
})

export type BlueprintTemplateExampleInput = z.infer<
  typeof BlueprintTemplateExampleInputSchema
>

/**
 * Example data for a blueprint template from GET /plugin/templateExampleValues.
 * Mirrors what the backend overlays during template ingest validation.
 */
export const TemplateExampleValuesSchema = z.object({
  /** Per-block example configuration values, keyed by block instance id then option id */
  example_values: z.record(
    z.string(),
    z.record(z.string(), BlueprintTemplateExampleInputSchema),
  ),
  /** Example glyph name-to-value pairs the user is expected to override */
  example_glyphs: z.record(z.string(), BlueprintTemplateExampleInputSchema),
})

export type TemplateExampleValues = z.infer<typeof TemplateExampleValuesSchema>

/**
 * Parse a "store:local" composite string (the blueprint `created_by` format
 * for plugin templates). Splits on the first colon.
 */
export function parsePluginIdString(id: string): PluginCompositeId {
  const separatorIndex = id.indexOf(':')
  if (separatorIndex === -1) {
    return { store: id, local: '' }
  }
  return {
    store: id.slice(0, separatorIndex),
    local: id.slice(separatorIndex + 1),
  }
}

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
  /** Enabled = its blocks appear in the catalogue. Reflects `plugin_enabled`,
   *  not merely whether it loaded. */
  isEnabled: boolean
  /** Whether plugin is installed (not available) */
  isInstalled: boolean
  /** Whether an update is available (latestVersion > version) */
  hasUpdate: boolean
  /** Last-updated UTC ISO, tz-aware (from update_datetime) */
  updatedAt: string | null
  /** Structured diagnostics when the plugin has errors or warnings */
  errorDetail: Array<PluginError> | null
  /** Highest severity among errorDetail entries */
  errorSeverity: PluginErrorSeverity | null
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

/** All-zero versions come from unstamped dev installs — nothing to compare against */
export function isUnstampedVersion(version: string): boolean {
  const segments = parseReleaseSegments(version)
  return segments !== null && segments.every((segment) => segment === 0)
}

/**
 * Transform a PluginDetail to UI-friendly PluginInfo
 */
export function toPluginInfo(
  id: PluginCompositeId,
  detail: PluginDetail,
  capabilities: Array<PluginCapability> = [],
): PluginInfo {
  const status = derivePluginStatus(detail)
  const isInstalled = detail.install_data !== null
  const loadedVersion = detail.install_data?.local_version ?? null
  const hasUpdate =
    isInstalled &&
    loadedVersion !== null &&
    !isUnstampedVersion(loadedVersion) &&
    detail.generic_data.remote_info !== null &&
    isNewerVersion(detail.generic_data.remote_info.version, loadedVersion)
  const allErrors: Array<PluginError> = [
    ...(detail.install_data?.install_errors ?? []),
    ...detail.load_errors,
  ]
  const errorDetail = allErrors.length ? allErrors : null

  return {
    id,
    displayId: toPluginDisplayId(id),
    name: detail.generic_data.store_info?.display_title ?? id.local,
    description: detail.generic_data.store_info?.display_description ?? '',
    author: detail.generic_data.store_info?.display_author ?? '',
    version: loadedVersion === 'unknown' ? null : loadedVersion,
    latestVersion: detail.generic_data.remote_info?.version ?? null,
    capabilities,
    status,
    isEnabled: detail.settings_data?.isEnabled ?? status === 'errored',
    isInstalled,
    hasUpdate,
    updatedAt: detail.install_data?.update_datetime
      ? toUtcIsoOrNull(detail.install_data.update_datetime)
      : null,
    errorDetail,
    errorSeverity: errorDetail ? pluginErrorsMaxSeverity(errorDetail) : null,
    comment: detail.generic_data.store_info?.comment ?? null,
    pipSource: detail.generic_data.store_info?.pip_source ?? null,
    moduleName: detail.generic_data.store_info?.module_name ?? null,
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
