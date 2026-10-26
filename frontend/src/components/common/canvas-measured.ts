/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { Node } from '@xyflow/react'

/** Rebuilt nodes keep the sizes React Flow measured on their predecessors;
 * without them the minimap and fitView see every node as unmeasured. */
export function withMeasured<T extends Node>(
  next: ReadonlyArray<T>,
  prev: ReadonlyArray<T>,
): Array<T> {
  const measured = new Map(prev.map((n) => [n.id, n.measured]))
  return next.map((n) =>
    n.measured === undefined && measured.get(n.id) !== undefined
      ? { ...n, measured: measured.get(n.id) }
      : n,
  )
}
