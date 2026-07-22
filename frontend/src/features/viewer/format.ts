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
 * Formatting helpers shared by the WMS viewers (single-lens and compare).
 */

/** First entry of a Base-UI slider value, which may be scalar or array. */
export function firstNumber(
  value: number | ReadonlyArray<number> | undefined,
): number {
  if (typeof value === 'number') return value
  if (Array.isArray(value)) {
    const v = value[0]
    return typeof v === 'number' ? v : 0
  }
  return 0
}

/**
 * Format a longitude/latitude pair as `lat,lon` to 3 decimals — at the
 * equator that's roughly 100 m precision, plenty for hover read-out.
 * Wraps `lon` into [-180, 180] so antimeridian crossings stay readable.
 */
export function formatLatLon(lat: number, lon: number): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  return `${lat.toFixed(3)}°, ${wrapped.toFixed(3)}°`
}

/** WMS TIME value → compact UTC display (`YYYY-MM-DD HH:mmZ`). */
export function formatStep(iso: string): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
  )
}
