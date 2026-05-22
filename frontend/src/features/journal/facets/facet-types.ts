/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Facet keys usable as `key:value` tokens in the journal search bar. */
export type FacetKey = 'model' | 'output' | 'tag' | 'date'

export const FACET_KEYS: ReadonlyArray<FacetKey> = [
  'model',
  'output',
  'tag',
  'date',
]

/** A parsed `key:value` filter token. */
export interface FacetToken {
  key: FacetKey
  value: string
}

/** A journal search query: facet tokens plus leftover free text. */
export interface ParsedQuery {
  tokens: Array<FacetToken>
  text: string
}
