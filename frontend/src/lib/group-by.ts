/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Group items by `keyFn`, preserving first-appearance order of keys. */
export function groupByKey<T>(
  items: ReadonlyArray<T>,
  keyFn: (item: T) => string,
): Array<[string, Array<T>]> {
  const buckets = new Map<string, Array<T>>()
  for (const item of items) {
    const key = keyFn(item)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      buckets.set(key, [item])
    }
  }
  return Array.from(buckets.entries())
}
