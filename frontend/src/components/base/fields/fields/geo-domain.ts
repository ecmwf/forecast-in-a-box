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
 * Pure helpers for the `geodomain` picker. No React or OpenLayers imports, so the
 * serialisation/mode-detection logic is unit-testable in isolation.
 *
 * A geodomain is stored as a single comma-separated string (the same wire encoding as
 * `list[str]`). It is one of four shapes:
 * - the exclusive `auto` sentinel (plot everything the data covers)
 * - preset/region names, e.g. `Europe`
 * - country names to union, e.g. `Germany,France,Italy`
 * - an integer bounding box `west,south,east,north` in whole degrees (exactly four integer tokens)
 * Anything else (free text, `${glyph}`) is treated as raw.
 */

import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'

/**
 * Preset domains, taken verbatim from earthkit-plots' built-in catalogue (data/geo/domains.yml)
 * in its shipped order. All resolve case-insensitively server-side.
 */
export const PRESET_DOMAINS = [
  'Global',
  'Europe',
  'Central Europe',
  'Northeast Europe',
  'Northwest Europe',
  'Southeast Europe',
  'Southwest Europe',
  'Mediterranean',
  'Denmark',
  'Ireland',
  'Svalbard',
  'Africa',
  'Antarctic',
  'Arctic',
  'Asia',
  'Oceania',
  'North Atlantic',
  'North America',
  'South America',
  'Contiguous United States',
] as const

/**
 * A bounding box in wire order `[west, south, east, north]` (whole degrees) — the same order
 * and units as core's `bbox` type, and the same layout as a lon/lat OpenLayers extent
 * (`[minX, minY, maxX, maxY]`). The backend runtime reorders to earthkit's `[W, E, S, N]`
 * at its boundary.
 */
export type Bbox = [west: number, south: number, east: number, north: number]

/** An OpenLayers extent: `[minX, minY, maxX, maxY]` = `[west, south, east, north]`. */
export type OlExtent = [number, number, number, number]

export type GeoDomainMode = 'presets' | 'countries' | 'bbox' | 'raw'

/**
 * Sentinel meaning "no restriction — plot everything the data covers". Exclusive: the backend
 * rejects it combined with other values, so selecting it always replaces the whole value.
 */
export const AUTO_DOMAIN = 'auto'

/** True if the stored value is exactly the exclusive `auto` sentinel. */
export function isAutoDomain(value: string): boolean {
  return value.trim().toLowerCase() === AUTO_DOMAIN
}

// Whole degrees only — mirrors core's integer bbox type.
const NUMERIC = /^-?\d+$/

/** Split a stored geodomain value into its comma-separated tokens (same as `list[str]`). */
export function tokenize(value: string): Array<string> {
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

/** A bbox is exactly four tokens that are all numeric (mirrors the backend's rule). */
export function isBboxTokens(tokens: Array<string>): boolean {
  return tokens.length === 4 && tokens.every((token) => NUMERIC.test(token))
}

/** Parse a stored value into a `[W, S, E, N]` bbox, or `null` if it is not a numeric bbox. */
export function parseBbox(value: string): Bbox | null {
  const tokens = tokenize(value)
  if (!isBboxTokens(tokens)) return null
  return tokens.map(Number) as Bbox
}

/** Serialise a bbox to the stored value, rounding to whole degrees. */
export function serializeBbox(bbox: Bbox): string {
  return bbox.map((coord) => Math.round(coord)).join(',')
}

/** Serialise selected names (presets or countries) to the stored value. */
export function serializeNames(names: ReadonlyArray<string>): string {
  return names.join(',')
}

/** Toggle a name in/out of a list, case-insensitively (used by map country clicks). */
export function toggleName(
  names: ReadonlyArray<string>,
  name: string,
): Array<string> {
  const exists = names.some(
    (existing) => existing.toLowerCase() === name.toLowerCase(),
  )
  return exists
    ? names.filter((existing) => existing.toLowerCase() !== name.toLowerCase())
    : [...names, name]
}

/**
 * Pick the active picker tab for an existing value. Precedence: empty/auto → presets,
 * glyph → raw, four-numeric → bbox, all-known-presets → presets, all-known-countries →
 * countries, otherwise raw. Names that are both a preset and a country resolve to presets.
 */
export function detectMode(
  value: string,
  presets: ReadonlyArray<string>,
  countries: ReadonlyArray<string>,
): GeoDomainMode {
  if (!value.trim() || isAutoDomain(value)) return 'presets'
  if (containsGlyphs(value)) return 'raw'
  const tokens = tokenize(value)
  if (isBboxTokens(tokens)) return 'bbox'
  const lower = tokens.map((token) => token.toLowerCase())
  const presetSet = new Set(presets.map((name) => name.toLowerCase()))
  if (lower.every((token) => presetSet.has(token))) return 'presets'
  const countrySet = new Set(countries.map((name) => name.toLowerCase()))
  if (lower.every((token) => countrySet.has(token))) return 'countries'
  return 'raw'
}

