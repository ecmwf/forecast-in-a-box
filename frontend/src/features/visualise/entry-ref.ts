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
 * /compare URL (`?a=…&b=…`), so it must be stable and reversible:
 *   `run:<jobId>~<taskId>` · `path:<path>` · `wms:<url>`
 * `~` is an RFC 3986 unreserved character and cannot appear in run/task
 * ids; the router URL-encodes path/url payloads.
 */

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
  | OutputComparisonEntry
  | PathComparisonEntry
  | WmsComparisonEntry

/** A ComparisonEntry before the store stamps `addedAt`. */
export type NewComparisonEntry =
  | Omit<OutputComparisonEntry, 'addedAt'>
  | Omit<PathComparisonEntry, 'addedAt'>
  | Omit<WmsComparisonEntry, 'addedAt'>

/** Decoded identity of a ref — the union minus display metadata. */
export type DecodedEntryRef =
  | { kind: 'output'; jobId: string; taskId: string }
  | { kind: 'path'; path: string }
  | { kind: 'wms'; url: string }

export function entryRef(entry: NewComparisonEntry | ComparisonEntry): string {
  switch (entry.kind) {
    case 'output':
      return `run:${entry.jobId}~${entry.taskId}`
    case 'path':
      return `path:${entry.path}`
    case 'wms':
      return `wms:${entry.url}`
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

/**
 * Slot-B URL sentinel for a deliberate single view — a plainly cleared B
 * would be re-filled by materialization. Refs carry `kind:`, no collision.
 */
export const SLOT_B_OFF = 'off'

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
