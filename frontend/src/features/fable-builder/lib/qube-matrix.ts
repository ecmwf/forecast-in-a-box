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
 * Parse a qube into its dimensions. A qube is treated purely as a set of named
 * dimensions, each with coordinate values — the foundation for the qube lens
 * (spectrum glyph, metrics, inspector). Nothing here is specific to any
 * dimension name.
 */

import type { QubeNode } from '@/api/types/artifacts.types'

export interface QubeDimension {
  key: string
  values: Array<string>
}

/** Order a dimension's values numerically when they all parse as numbers,
 *  otherwise leave them in first-seen order. */
function sortValues(values: ReadonlyArray<string>): Array<string> {
  const allNumeric = values.every(
    (value) => value !== '' && !Number.isNaN(Number(value)),
  )
  if (!allNumeric) return [...values]
  return [...values].sort((a, b) => Number(a) - Number(b))
}

/**
 * Every dimension of the qube in tree order, each with the union of its
 * coordinate values. A compressed qube node shares one set of children across
 * all its values, so we recurse into children once per node — O(nodes), never
 * expanding the cartesian product.
 */
export function parseQubeDimensions(root: QubeNode): Array<QubeDimension> {
  const order: Array<string> = []
  const byKey = new Map<string, Set<string>>()

  const visit = (node: QubeNode, isRoot: boolean): void => {
    if (!isRoot) {
      let set = byKey.get(node.key)
      if (!set) {
        set = new Set<string>()
        byKey.set(node.key, set)
        order.push(node.key)
      }
      for (const value of node.values.values) set.add(String(value))
    }
    for (const child of node.children) visit(child, false)
  }

  visit(root, true)
  return order.map((key) => ({
    key,
    values: sortValues([...(byKey.get(key) ?? new Set<string>())]),
  }))
}
