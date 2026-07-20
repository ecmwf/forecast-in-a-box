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
 * Cluster a sorted layer list by shared leading words, so catalogs with
 * hundreds of "Air temperature …" variants read as collapsible groups
 * whose children show only the differing suffix. Server-agnostic — pure
 * title clustering, no reliance on WMS hierarchy.
 */

/** Runs shorter than this stay ungrouped. */
const MIN_RUN = 3
/** Prefixes shorter than this (chars) are too generic to group on. */
const MIN_PREFIX_CHARS = 3

export interface TitleGroupItem<T> {
  item: T
  /** Title with the group prefix stripped (full title when ungrouped). */
  shortTitle: string
}

export interface TitleGroup<T> {
  /** null → ungrouped run, rendered flat. */
  prefix: string | null
  items: Array<TitleGroupItem<T>>
}

function commonWordPrefix(a: string, b: string): string {
  const wa = a.split(' ')
  const wb = b.split(' ')
  const out: Array<string> = []
  for (let i = 0; i < Math.min(wa.length, wb.length); i++) {
    if (wa[i] !== wb[i]) break
    out.push(wa[i])
  }
  return out.join(' ')
}

function startsAtWordBoundary(title: string, prefix: string): boolean {
  if (!title.startsWith(prefix)) return false
  const next = title.charAt(prefix.length)
  return next === '' || next === ' '
}

export function groupByTitlePrefix<T>(
  items: ReadonlyArray<T>,
  getTitle: (item: T) => string,
): Array<TitleGroup<T>> {
  // Code-unit sort — localeCompare ignores spaces, which would interleave
  // "Airmass" into the "Air …" run and split it.
  const sorted = [...items].sort((x, y) => {
    const tx = getTitle(x)
    const ty = getTitle(y)
    return tx < ty ? -1 : tx > ty ? 1 : 0
  })
  const groups: Array<TitleGroup<T>> = []
  let flat: Array<TitleGroupItem<T>> = []
  const flushFlat = () => {
    if (flat.length > 0) groups.push({ prefix: null, items: flat })
    flat = []
  }

  let i = 0
  while (i < sorted.length) {
    const prefix =
      i + MIN_RUN - 1 < sorted.length
        ? commonWordPrefix(getTitle(sorted[i]), getTitle(sorted[i + MIN_RUN - 1]))
        : ''
    if (prefix.length < MIN_PREFIX_CHARS) {
      flat.push({ item: sorted[i], shortTitle: getTitle(sorted[i]) })
      i++
      continue
    }
    let end = i
    while (
      end < sorted.length &&
      startsAtWordBoundary(getTitle(sorted[end]), prefix)
    ) {
      end++
    }
    flushFlat()
    groups.push({
      prefix,
      items: sorted.slice(i, end).map((item) => {
        const title = getTitle(item)
        return {
          item,
          shortTitle: title.slice(prefix.length).trim() || title,
        }
      }),
    })
    i = end
  }
  flushFlat()
  return groups
}
