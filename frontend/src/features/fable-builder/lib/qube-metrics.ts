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
 * Qube summary: dimension count and field count (the exact product of dimension
 * sizes).
 */

import { parseQubeDimensions } from './qube-matrix'
import type { QubeNode } from '@/api/types/artifacts.types'
import type { QubeDimension } from './qube-matrix'

export interface QubeMetrics {
  dimensions: Array<QubeDimension>
  /** Number of dimensions in the qube. */
  dimensionCount: number
  /** Product of every dimension's value count; an empty/dimensionless qube is 1. */
  fieldCount: number
}

/** Summarize a qube as dimension count and (exact) field count. */
export function computeQubeMetrics(node: QubeNode): QubeMetrics {
  const dimensions = parseQubeDimensions(node)
  const fieldCount = dimensions.reduce((acc, dim) => acc * dim.values.length, 1)
  return {
    dimensions,
    dimensionCount: dimensions.length,
    fieldCount,
  }
}
