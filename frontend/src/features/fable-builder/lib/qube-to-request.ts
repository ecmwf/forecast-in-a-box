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
 * Render a qube as a plain `key = v1, v2, …` selection (one line per dimension).
 * Deliberately not MARS syntax — the qube can come from MARS, Anemoi or Open
 * Data, so this is a source-neutral description of the selected coordinates.
 */

import { parseQubeDimensions } from './qube-matrix'
import type { QubeNode } from '@/api/types/artifacts.types'

/** A readable `key = values` selection, one dimension per line. Empty string
 *  when the qube has no dimensions. */
export function qubeToRequest(node: QubeNode): string {
  const dimensions = parseQubeDimensions(node)
  if (dimensions.length === 0) return ''
  return dimensions
    .map((dim) => `${dim.key} = ${dim.values.join(', ')}`)
    .join('\n')
}
