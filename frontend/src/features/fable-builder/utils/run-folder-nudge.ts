/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Helpers for the "not a per-run folder" nudge under a sink's path. */

import type { PluginBlockFactoryId } from '@/api/types/fable.types'
import { findGlyphSpans } from '@/features/fable-builder/utils/glyph-display'

/** Folder the fix inserts, as in the ecmwf plugin's templates. */
export const RUN_FOLDER = '${runId}__${attemptCount}'

/** Which part of the path must be per run: the GRIB file's folder, or the whole Zarr store. */
export type RunScope = 'folder' | 'path'

export interface RunScopedPath {
  configKey: string
  scope: RunScope
}

/** ecmwf plugin sinks that write to disk, by factory name. */
const RUN_SCOPED_PATHS: Record<string, RunScopedPath | undefined> = {
  gribSink: { configKey: 'path', scope: 'folder' },
  zarrSink: { configKey: 'path', scope: 'path' },
}

/** The factory's output path option, or null when it writes nothing to disk. */
export function runScopedPath(
  factoryId: PluginBlockFactoryId,
): RunScopedPath | null {
  return RUN_SCOPED_PATHS[factoryId.factory] ?? null
}

/** The part of the path that must be per run. */
function scopedPart(path: string, scope: RunScope): string {
  return scope === 'folder'
    ? path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    : path
}

/** True when a resolved path lacks the run ID in the part that must be per run. */
export function isSharedAcrossRuns(
  resolved: string,
  runId: string,
  scope: RunScope,
): boolean {
  return !scopedPart(resolved, scope).includes(runId)
}

/** True when the raw value uses the runId glyph in the part that must be per run. */
export function namesRunId(value: string, scope: RunScope): boolean {
  return /\$\{\s*runId\b/.test(scopedPart(value, scope))
}

/** Insert the run folder before the last path segment; null when no `/` lies outside a glyph. */
export function withRunFolder(value: string): string | null {
  const spans = findGlyphSpans(value)
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] !== '/') continue
    if (spans.some((s) => i >= s.start && i < s.end)) continue
    return `${value.slice(0, i + 1)}${RUN_FOLDER}/${value.slice(i + 1)}`
  }
  return null
}
