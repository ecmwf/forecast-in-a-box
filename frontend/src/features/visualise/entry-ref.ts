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
 * Comparison entries and their stable string refs.
 *
 * A comparison *source* is anything that yields a WMS base URL:
 *  - `output` — a stored run output (GRIB dir marker) served via a lens
 *  - `path`   — a directory on the FIAB host served via a lens
 *  - `wms`    — an external WMS endpoint used directly
 *
 * The ref is the entry's identity in both the basket store and the
 * /compare URL (`?a=…&b=…`), so it must be stable:
 *   `run:<jobId>~<taskId>` · `dir:<digest>` · `wms:<url>` · `wmsp:<digest>`
 * `~` is an RFC 3986 unreserved character and cannot appear in run/task
 * ids; the router URL-encodes url payloads. Host paths and
 * credential-bearing WMS endpoints serialize as opaque digests — a raw
 * path in a shareable URL would let a crafted link name the directory the
 * backend serves, a `?token=…` URL would leak the secret; digest refs
 * resolve only against the local basket. Legacy `path:` refs decode,
 * never produced.
 */

import { CURATED_WMS_SERVERS } from './curated-wms'

/** Stored run output — display metadata is snapshotted at add time and
 *  enriched lazily (runs can be deleted; the basket stays readable). */
export interface OutputComparisonEntry {
  kind: 'output'
  jobId: string
  taskId: string
  /** Sink block id (`original_block`) the marker task belongs to. */
  blockId: string
  /** Blueprint display name; '' until enriched. */
  runName: string
  /** Sink factory title; falls back to blockId. */
  blockTitle: string
  /** Run creation time (ISO) — closest available base-time proxy. */
  runCreatedAt: string | null
  addedAt: number
}

/** GRIB directory on the FIAB host — a lens is started on it directly. */
export interface PathComparisonEntry {
  kind: 'path'
  path: string
  label: string
  addedAt: number
}

/** External WMS server used as-is (must send CORS headers). */
export interface WmsComparisonEntry {
  kind: 'wms'
  url: string
  label: string
  addedAt: number
}

export type ComparisonEntry =
  OutputComparisonEntry | PathComparisonEntry | WmsComparisonEntry

/** A ComparisonEntry before the store stamps `addedAt`. */
export type NewComparisonEntry =
  | Omit<OutputComparisonEntry, 'addedAt'>
  | Omit<PathComparisonEntry, 'addedAt'>
  | Omit<WmsComparisonEntry, 'addedAt'>

/** Decoded ref identity — `dir`/`wmsp` are local digests, `path` the legacy raw form. */
export type DecodedEntryRef =
  | { kind: 'output'; jobId: string; taskId: string }
  | { kind: 'dir'; digest: string }
  | { kind: 'wmsp'; digest: string }
  | { kind: 'path'; path: string }
  | { kind: 'wms'; url: string }

/** FNV-1a 32-bit hex — deterministic so persisted URLs keep matching the basket. */
function refDigest(payload: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Query params whose values are likely credentials. */
const SECRET_QUERY_PARAM =
  /(?:^|[_-])(token|key|apikey|secret|password|signature|sig|auth)$/i

// Vetted public endpoints — their tokens (e.g. eccharts `token=public`)
// ship with the app and stay shareable.
const CURATED_URLS = new Set(
  CURATED_WMS_SERVERS.map((s) => new URL(s.url).toString()),
)

/** Secret-bearing endpoint (userinfo or credential query param, curated exempt). */
export function wmsUrlIsPrivate(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (CURATED_URLS.has(parsed.toString())) return false
    if (parsed.username || parsed.password) return true
    return [...parsed.searchParams.keys()].some((name) =>
      SECRET_QUERY_PARAM.test(name),
    )
  } catch {
    return true
  }
}

/** Mask secret values for display ("token=***"); public URLs pass through. */
export function redactWmsUrl(url: string): string {
  if (!wmsUrlIsPrivate(url)) return url
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    for (const name of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_PARAM.test(name)) parsed.searchParams.set(name, '***')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function entryRef(entry: NewComparisonEntry | ComparisonEntry): string {
  switch (entry.kind) {
    case 'output':
      return `run:${entry.jobId}~${entry.taskId}`
    case 'path':
      return `dir:${refDigest(entry.path)}`
    case 'wms':
      return wmsUrlIsPrivate(entry.url)
        ? `wmsp:${refDigest(entry.url)}`
        : `wms:${entry.url}`
  }
}

/** Parse a ref back into its identity; null for malformed input. */
export function decodeEntryRef(ref: string): DecodedEntryRef | null {
  if (ref.startsWith('run:')) {
    const payload = ref.slice('run:'.length)
    const sep = payload.indexOf('~')
    if (sep <= 0 || sep === payload.length - 1) return null
    return {
      kind: 'output',
      jobId: payload.slice(0, sep),
      taskId: payload.slice(sep + 1),
    }
  }
  if (ref.startsWith('dir:')) {
    const digest = ref.slice('dir:'.length)
    return digest ? { kind: 'dir', digest } : null
  }
  if (ref.startsWith('wmsp:')) {
    const digest = ref.slice('wmsp:'.length)
    return digest ? { kind: 'wmsp', digest } : null
  }
  // Legacy raw-path refs: decoded for consent-gated hydration, never emitted.
  if (ref.startsWith('path:')) {
    const path = ref.slice('path:'.length)
    return path ? { kind: 'path', path } : null
  }
  if (ref.startsWith('wms:')) {
    const url = ref.slice('wms:'.length)
    return url ? { kind: 'wms', url } : null
  }
  return null
}

/** Host-path allowlist (cf. allowedWmsUrl): absolute and traversal-free, else null. */
export function allowedHostPath(raw: string): string | null {
  const path = raw.trim()
  if (!path.startsWith('/')) return null
  if (path.split('/').some((seg) => seg === '..')) return null
  return path
}

/**
 * Slot-B URL sentinel for a deliberate single view — a plainly cleared B
 * would be re-filled by materialization. Refs carry `kind:`, no collision.
 */
export const SLOT_B_OFF = 'off'

/** Kind + distinguishing detail for pickers (dates formatted by caller). */
export function entryDetail(entry: ComparisonEntry): {
  kind: 'run' | 'wms' | 'folder'
  detail: string
} {
  switch (entry.kind) {
    case 'output':
      return { kind: 'run', detail: entry.jobId.slice(0, 8) }
    case 'wms':
      try {
        return { kind: 'wms', detail: new URL(entry.url).host }
      } catch {
        return { kind: 'wms', detail: entry.url }
      }
    case 'path':
      return {
        kind: 'folder',
        detail: entry.path.replace(/\/$/, '').split('/').pop() ?? entry.path,
      }
  }
}

/** Human-readable name for toasts and chips. */
export function entryDisplayName(
  entry: NewComparisonEntry | ComparisonEntry,
): string {
  switch (entry.kind) {
    case 'output':
      return entry.runName || entry.blockTitle || entry.jobId.slice(0, 8)
    case 'path':
    case 'wms':
      return entry.label
  }
}
