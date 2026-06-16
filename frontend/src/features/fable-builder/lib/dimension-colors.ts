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
 * Stable dimension-name to hex-color mapping, so a given dimension is rendered
 * in the same color everywhere (edge glyphs, inspector dots, ...). Common
 * MARS/forecast dimensions are pinned to a hand-picked, visually-distinct
 * palette; any other name is hashed deterministically into a fallback palette.
 */

/** Pinned colors for the common MARS/forecast dimensions (Tailwind-500-ish). */
const PINNED: Record<string, string> = {
  class: '#ef4444', // red
  stream: '#f97316', // orange
  expver: '#f59e0b', // amber
  type: '#84cc16', // lime
  levtype: '#14b8a6', // teal
  levelist: '#10b981', // emerald
  param: '#3b82f6', // blue
  number: '#6366f1', // indigo
  step: '#8b5cf6', // violet
  time: '#d946ef', // fuchsia
  domain: '#64748b', // slate
}

/** Fallback palette for unknown dimensions, kept clear of the pinned hues. */
const FALLBACK: ReadonlyArray<string> = [
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#a855f7', // purple
  '#22c55e', // green
  '#0ea5e9', // sky
  '#f43f5e', // rose
  '#0d9488', // teal-600
  '#7c3aed', // violet-600
  '#db2777', // pink-600
]

/** FNV-1a-ish stable string hash → non-negative 32-bit integer. */
function hashName(name: string): number {
  let hash = 2166136261
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Stable hex color for a dimension name. Pinned names always map to their
 * curated hue; unknown names hash deterministically into the fallback palette,
 * so the color is consistent across renders and sessions.
 */
export function dimensionColor(name: string): string {
  const pinned = PINNED[name] as string | undefined
  if (pinned !== undefined) return pinned
  return FALLBACK[hashName(name) % FALLBACK.length]
}
