/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Split coordinates of run outputs: ordering, stepping and filtering. */

import type { OutputItem } from './types'

/** One split coordinate as sent by the backend, e.g. ["step", "6"]. */
export type OutputDim = readonly [key: string, value: string]

/** Dimensions ordered innermost. */
const TIME_DIMS: ReadonlySet<string> = new Set([
  'step',
  'date',
  'time',
  'valid_datetime',
])

const collator = new Intl.Collator(undefined, { numeric: true })

/** Numeric order when both values are numbers, else natural string order. */
export function compareDimValues(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return na - nb
  }
  return collator.compare(a, b)
}

/** Outer to inner: wire order with time dimensions moved last. */
export function orderDims(dims: ReadonlyArray<OutputDim>): Array<OutputDim> {
  return [
    ...dims.filter(([key]) => !TIME_DIMS.has(key)),
    ...dims.filter(([key]) => TIME_DIMS.has(key)),
  ]
}

/** Block name plus subtitle. */
export function outputTitle(item: OutputItem): string {
  return item.subtitle ? `${item.blockName} · ${item.subtitle}` : item.blockName
}

export function dimValue(item: OutputItem, key: string): string | undefined {
  return item.dims?.find(([k]) => k === key)?.[1]
}

/** Compares the coordinates both items share, outer to inner. */
export function compareDims(a: OutputItem, b: OutputItem): number {
  for (const [key, value] of orderDims(a.dims ?? [])) {
    const other = dimValue(b, key)
    if (other === undefined) continue
    const cmp = compareDimValues(value, other)
    if (cmp !== 0) return cmp
  }
  return 0
}
