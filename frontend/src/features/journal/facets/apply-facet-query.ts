/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Generic faceted-filter core shared by the run, schedule and preset lists. */

import type {
  FacetKey,
  ParsedQuery,
} from '@/features/journal/facets/facet-types'

interface FacetQueryConfig<T> {
  /** Facet keys this list understands; tokens with other keys fold into free text. */
  supportedKeys: ReadonlyArray<FacetKey>
  /** True when `item` matches one `key:value` facet token. */
  matchFacet: (item: T, key: FacetKey, value: string) => boolean
  /** True when `item` matches the lower-cased free-text needle. */
  matchText: (item: T, text: string) => boolean
}

/** Apply a parsed faceted query — facets OR within a key, AND across keys. */
export function applyFacetQuery<T>(
  items: ReadonlyArray<T>,
  query: ParsedQuery,
  config: FacetQueryConfig<T>,
): Array<T> {
  let result = [...items]

  const valuesByKey = new Map<FacetKey, Array<string>>()
  const extraText: Array<string> = []
  for (const token of query.tokens) {
    if (config.supportedKeys.includes(token.key)) {
      const values = valuesByKey.get(token.key) ?? []
      values.push(token.value)
      valuesByKey.set(token.key, values)
    } else {
      extraText.push(token.value)
    }
  }

  for (const [key, values] of valuesByKey) {
    result = result.filter((item) =>
      values.some((value) => config.matchFacet(item, key, value)),
    )
  }

  const text = [query.text, ...extraText].join(' ').trim().toLowerCase()
  if (text) {
    result = result.filter((item) => config.matchText(item, text))
  }

  return result
}
