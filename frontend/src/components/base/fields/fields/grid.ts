/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** `grid` value rules, mirroring fiab-core's GridType. */

export const AUTO_GRID = 'auto'

/** The finest lat/lon increment in degrees, inclusive. */
export const MIN_GRID_RESOLUTION = 0.1

/** The inclusive range of a Gaussian grid number, such as 320 in `N320`. */
export const MIN_GAUSSIAN_NUMBER = 1
export const MAX_GAUSSIAN_NUMBER = 1280

/** Global grids above this many points are flagged as large. */
export const LARGE_GRID_POINTS = 5_000_000

/** fiab-plugin-ecmwf's suggestions, used for a bare `grid` option. */
export const DEFAULT_GRID_SUGGESTIONS: ReadonlyArray<string> = [
  'auto',
  '0.25',
  '0.5',
  '1',
  'O96',
  'O320',
  'N320',
]

export type GridSpec =
  | { kind: 'auto' }
  | { kind: 'latlon'; dx: number; dy: number; pair: boolean }
  | { kind: 'gaussian'; family: 'N' | 'O'; number: number }

export type GridError =
  | { code: 'notGrid' }
  | { code: 'tooManyParts' }
  | { code: 'notPositive'; resolution: string }
  | { code: 'tooFine'; resolution: string }
  | { code: 'gaussianRange' }
  | { code: 'leadingZeros' }

export type GridParseResult =
  { ok: true; spec: GridSpec } | { ok: false; error: GridError }

const GAUSSIAN = /^([NnOo])(\d+)$/
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const NON_FINITE = /^[+-]?(inf|infinity|nan)$/i

/** Parse a grid with GridType's rules, checked in its order. */
export function parseGrid(raw: string): GridParseResult {
  const value = raw.trim()
  if (value === AUTO_GRID) return { ok: true, spec: { kind: 'auto' } }

  const gaussian = GAUSSIAN.exec(value)
  if (gaussian) {
    const digits = gaussian[2]
    const number = Number(digits)
    if (number < MIN_GAUSSIAN_NUMBER || number > MAX_GAUSSIAN_NUMBER) {
      return { ok: false, error: { code: 'gaussianRange' } }
    }
    if (digits !== String(number)) {
      return { ok: false, error: { code: 'leadingZeros' } }
    }
    const family = gaussian[1].toUpperCase() === 'N' ? 'N' : 'O'
    return { ok: true, spec: { kind: 'gaussian', family, number } }
  }

  const parts = value.split('/').map((part) => part.trim())
  if (parts.length > 2) return { ok: false, error: { code: 'tooManyParts' } }
  const resolutions: Array<number> = []
  for (const part of parts) {
    if (NON_FINITE.test(part)) {
      return { ok: false, error: { code: 'notPositive', resolution: part } }
    }
    if (!DECIMAL.test(part)) return { ok: false, error: { code: 'notGrid' } }
    const resolution = Number(part)
    if (!(resolution > 0) || !Number.isFinite(resolution)) {
      return { ok: false, error: { code: 'notPositive', resolution: part } }
    }
    if (resolution < MIN_GRID_RESOLUTION) {
      return { ok: false, error: { code: 'tooFine', resolution: part } }
    }
    resolutions.push(resolution)
  }
  const [dx, dy = dx] = resolutions
  return {
    ok: true,
    spec: { kind: 'latlon', dx, dy, pair: resolutions.length === 2 },
  }
}

/** The canonical stored string: upper-case names, shortest decimals. */
function gridToString(spec: GridSpec): string {
  switch (spec.kind) {
    case 'auto':
      return AUTO_GRID
    case 'gaussian':
      return `${spec.family}${spec.number}`
    case 'latlon':
      return spec.pair ? `${spec.dx}/${spec.dy}` : String(spec.dx)
  }
}

/** Canonical form of a valid grid, else null. */
export function canonicalGrid(raw: string): string | null {
  const parsed = parseGrid(raw)
  return parsed.ok ? gridToString(parsed.spec) : null
}

/** True if two stored grids name the same grid, e.g. `n320` and `N320`. */
export function isSameGrid(a: string, b: string): boolean {
  return (canonicalGrid(a) ?? a) === (canonicalGrid(b) ?? b)
}

// The reduced (N) Gaussian grids have no closed-form point count.
const REDUCED_GAUSSIAN_POINTS: ReadonlyMap<number, number> = new Map([
  [320, 542_080],
])
// N320's share of the full 4N x 2N grid, to estimate other N grids.
const REDUCED_GAUSSIAN_SHARE = 542_080 / (8 * 320 * 320)

/** Points of the global grid; `approx` when it is estimated. */
export function gridPoints(
  spec: GridSpec,
): { count: number; approx: boolean } | null {
  switch (spec.kind) {
    case 'auto':
      return null
    case 'latlon': {
      // Epsilon: 360/0.1 must count 3600 columns.
      const columns = Math.floor(360 / spec.dx + 1e-9)
      const rows = Math.floor(180 / spec.dy + 1e-9) + 1
      return { count: columns * rows, approx: false }
    }
    case 'gaussian': {
      const n = spec.number
      if (spec.family === 'O') return { count: 4 * n * (n + 9), approx: false }
      const known = REDUCED_GAUSSIAN_POINTS.get(n)
      return known !== undefined
        ? { count: known, approx: false }
        : {
            count: Math.round(8 * n * n * REDUCED_GAUSSIAN_SHARE),
            approx: true,
          }
    }
  }
}

const KM_PER_DEGREE = 111.2
const EARTH_AREA_KM2 = 4 * Math.PI * 6371 ** 2

/** Approximate spacing in km: equatorial for lat/lon, mean for Gaussian. */
export function gridSpacingKm(spec: GridSpec): number | null {
  switch (spec.kind) {
    case 'auto':
      return null
    case 'latlon':
      return Math.max(1, Math.round(Math.max(spec.dx, spec.dy) * KM_PER_DEGREE))
    case 'gaussian': {
      const points = gridPoints(spec)
      return points === null
        ? null
        : Math.max(1, Math.round(Math.sqrt(EARTH_AREA_KM2 / points.count)))
    }
  }
}

export type GridGroupKey =
  'custom' | 'keep' | 'latlon' | 'octahedral' | 'reduced'

export interface GridGroup {
  value: GridGroupKey
  items: Array<string>
}

const GROUP_ORDER: ReadonlyArray<GridGroupKey> = [
  'custom',
  'keep',
  'latlon',
  'octahedral',
  'reduced',
]

function groupOf(spec: GridSpec): GridGroupKey {
  if (spec.kind === 'auto') return 'keep'
  if (spec.kind === 'latlon') return 'latlon'
  return spec.family === 'O' ? 'octahedral' : 'reduced'
}

function sortKey(spec: GridSpec): number {
  if (spec.kind === 'latlon') return spec.dx * 1e6 + spec.dy
  return spec.kind === 'gaussian' ? spec.number : 0
}

/** Valid grids by family, sorted; adds `value` and `typed` if unlisted. */
export function groupGridOptions(
  options: ReadonlyArray<string>,
  value: string,
  typed: string | null,
): Array<GridGroup> {
  const entries: Array<{ item: string; spec: GridSpec; group: GridGroupKey }> =
    []
  const add = (item: string, group?: GridGroupKey) => {
    const parsed = parseGrid(item)
    if (!parsed.ok) return
    if (entries.some((entry) => isSameGrid(entry.item, item))) return
    entries.push({
      item,
      spec: parsed.spec,
      group: group ?? groupOf(parsed.spec),
    })
  }
  options.forEach((option) => add(option))
  if (value.trim()) add(value)
  if (typed) add(typed, 'custom')

  return GROUP_ORDER.flatMap((key) => {
    const items = entries
      .filter((entry) => entry.group === key)
      .sort((a, b) => sortKey(a.spec) - sortKey(b.spec))
      .map((entry) => entry.item)
    return items.length > 0 ? [{ value: key, items }] : []
  })
}
