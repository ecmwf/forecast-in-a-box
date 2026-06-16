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
 * Qube summary: dimension count, field count (exact product of dimension sizes),
 * and a rough size. The size is a demo estimate only — it assumes a fixed
 * per-field size; the real one needs the grid resolution (not carried here).
 */

import { parseQubeDimensions } from './qube-matrix'
import type { QubeNode } from '@/api/types/artifacts.types'
import type { QubeDimension } from './qube-matrix'

/** Rough size of one field (≈ one global lat/lon grid): ~1 MB. Demo estimate. */
export const BYTES_PER_FIELD = 1_000_000

export interface QubeMetrics {
  dimensions: Array<QubeDimension>
  /** Number of dimensions in the qube. */
  dimensionCount: number
  /** Product of every dimension's value count; an empty/dimensionless qube is 1. */
  fieldCount: number
  /** `fieldCount * BYTES_PER_FIELD` — indicative only (see file header). */
  estimatedBytes: number
}

/** Summarize a qube as dimension count, (exact) field count, and rough size. */
export function computeQubeMetrics(node: QubeNode): QubeMetrics {
  const dimensions = parseQubeDimensions(node)
  const fieldCount = dimensions.reduce((acc, dim) => acc * dim.values.length, 1)
  return {
    dimensions,
    dimensionCount: dimensions.length,
    fieldCount,
    estimatedBytes: fieldCount * BYTES_PER_FIELD,
  }
}

/** Compact count for the small edge glyph: 8200 → "8.2k", 1500000 → "1.5M", 204 → "204". */
export function formatCompactCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Human-readable byte size, stepping up to PB so large qubes stay short. */
export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = n
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit += 1
  }
  // Whole numbers up to MB, one decimal above (e.g. "920 KB", "13.6 TB").
  const rounded = unit <= 2 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}
