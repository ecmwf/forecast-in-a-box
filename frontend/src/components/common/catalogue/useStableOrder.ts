/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import type { CatalogueSortSetting } from '@/stores/uiStore'

export type CatalogueSort = CatalogueSortSetting
export type SortDir = CatalogueSort['dir']

export interface SortOption<T> {
  key: string
  label: string
  compare: (a: T, b: T) => number
  /** Initial direction; defaults to `asc`. */
  defaultDir?: SortDir
}

/** Sorts once per `resetKey`; later value changes don't move items. */
export function useStableOrder<T>(
  items: Array<T>,
  getKey: (item: T) => string,
  compare: (a: T, b: T) => number,
  resetKey: string,
): Array<T> {
  const [frozen, setFrozen] = useState<{
    resetKey: string
    rank: Map<string, number>
  }>({ resetKey: '', rank: new Map() })

  let next = frozen
  if (next.resetKey !== resetKey) next = { resetKey, rank: new Map() }
  const unranked = items.filter((item) => !next.rank.has(getKey(item)))
  if (unranked.length > 0) {
    const rank = new Map(next.rank)
    for (const item of [...unranked].sort(compare)) {
      rank.set(getKey(item), rank.size)
    }
    next = { resetKey, rank }
  }
  if (next !== frozen) setFrozen(next)

  const rankOf = (item: T) => next.rank.get(getKey(item)) ?? 0
  return [...items].sort((a, b) => rankOf(a) - rankOf(b))
}

/** Resolves a stored sort against `options` (first is the fallback). */
export function resolveCatalogueSort<T>(
  options: Array<SortOption<T>>,
  stored: CatalogueSort,
  setStored: (sort: CatalogueSort) => void,
  byName: (a: T, b: T) => number,
) {
  const option = options.find((o) => o.key === stored.key) ?? options[0]
  const sort =
    option.key === stored.key
      ? stored
      : { key: option.key, dir: 'asc' as const }
  const dirSign = sort.dir === 'asc' ? 1 : -1
  return {
    sort,
    compare: (a: T, b: T) => dirSign * option.compare(a, b) || byName(a, b),
    // Same column flips; a new one starts at its default.
    onSortChange: (key: string) =>
      setStored(
        key === sort.key
          ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : {
              key,
              dir: options.find((o) => o.key === key)?.defaultDir ?? 'asc',
            },
      ),
    onSortSelect: (key: string) =>
      key !== sort.key &&
      setStored({
        key,
        dir: options.find((o) => o.key === key)?.defaultDir ?? 'asc',
      }),
    onSortDirToggle: () =>
      setStored({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }),
  }
}
