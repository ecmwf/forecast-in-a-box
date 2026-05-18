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
 * The journal search grammar — GitHub/Linear-style `key:value` tokens mixed
 * with free text, e.g. `model:aifs tag:production europe`.
 */

import { FACET_KEYS } from './facet-types'
import type { FacetKey, FacetToken, ParsedQuery } from './facet-types'

const FACET_KEY_SET = new Set<string>(FACET_KEYS)

/** Matches, in priority order: `key:"quoted value"`, `key:bare`, `bareword`. */
const TOKEN_RE = /(\w+):"([^"]*)"|(\w+):(\S+)|(\S+)/g

/** Parse a raw search string into facet tokens plus leftover free text. */
export function parseQuery(raw: string): ParsedQuery {
  const tokens: Array<FacetToken> = []
  const textParts: Array<string> = []

  for (const match of raw.matchAll(TOKEN_RE)) {
    // Unmatched alternation branches leave undefined groups, which RegExpMatchArray typing omits.
    const [, quotedKey, quotedVal, bareKey, bareVal, plain] = match as Array<
      string | undefined
    >
    const key = quotedKey ?? bareKey
    const value = quotedKey != null ? quotedVal : bareVal

    if (key != null && value && FACET_KEY_SET.has(key.toLowerCase())) {
      tokens.push({ key: key.toLowerCase() as FacetKey, value })
    } else if (key != null) {
      // Unknown key (or empty value): keep the whole fragment as free text.
      textParts.push(`${key}:${value ?? ''}`)
    } else if (plain) {
      textParts.push(plain)
    }
  }

  return { tokens, text: textParts.join(' ') }
}

/** Serialise tokens + free text back into a raw query string. */
export function serializeQuery(query: ParsedQuery): string {
  const tokenStr = query.tokens
    .map((token) => {
      const value = /\s/.test(token.value) ? `"${token.value}"` : token.value
      return `${token.key}:${value}`
    })
    .join(' ')
  return [tokenStr, query.text.trim()].filter(Boolean).join(' ')
}

/** True when two tokens share a key and a case-insensitive value. */
function sameToken(a: FacetToken, b: FacetToken): boolean {
  return a.key === b.key && a.value.toLowerCase() === b.value.toLowerCase()
}

/** Add a token to a raw query (no-op if already present). */
export function addToken(raw: string, token: FacetToken): string {
  const query = parseQuery(raw)
  if (query.tokens.some((existing) => sameToken(existing, token))) return raw
  return serializeQuery({ ...query, tokens: [...query.tokens, token] })
}

/** Remove a token from a raw query. */
export function removeToken(raw: string, token: FacetToken): string {
  const query = parseQuery(raw)
  return serializeQuery({
    ...query,
    tokens: query.tokens.filter((existing) => !sameToken(existing, token)),
  })
}
