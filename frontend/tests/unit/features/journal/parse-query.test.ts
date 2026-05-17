/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** parse-query Unit Tests — the journal `key:value` search grammar. */

import { describe, expect, it } from 'vitest'
import {
  addToken,
  parseQuery,
  removeToken,
  serializeQuery,
} from '@/features/journal/facets/parse-query'

describe('parseQuery', () => {
  it('returns empty for a blank string', () => {
    expect(parseQuery('')).toEqual({ tokens: [], text: '' })
  })

  it('parses a bare facet token', () => {
    expect(parseQuery('model:aifs')).toEqual({
      tokens: [{ key: 'model', value: 'aifs' }],
      text: '',
    })
  })

  it('parses a quoted facet value with spaces', () => {
    expect(parseQuery('model:"Anemoi Model Source"')).toEqual({
      tokens: [{ key: 'model', value: 'Anemoi Model Source' }],
      text: '',
    })
  })

  it('separates facet tokens from free text', () => {
    const query = parseQuery('tag:production europe model:aifs')
    expect(query.tokens).toEqual([
      { key: 'tag', value: 'production' },
      { key: 'model', value: 'aifs' },
    ])
    expect(query.text).toBe('europe')
  })

  it('treats an unknown key as free text', () => {
    const query = parseQuery('foo:bar')
    expect(query.tokens).toEqual([])
    expect(query.text).toBe('foo:bar')
  })

  it('lower-cases the facet key', () => {
    expect(parseQuery('TAG:x').tokens).toEqual([{ key: 'tag', value: 'x' }])
  })
})

describe('serializeQuery', () => {
  it('round-trips tokens and free text', () => {
    const raw = 'model:aifs tag:production europe'
    expect(serializeQuery(parseQuery(raw))).toBe(raw)
  })

  it('quotes values containing spaces', () => {
    expect(
      serializeQuery({ tokens: [{ key: 'model', value: 'A B' }], text: '' }),
    ).toBe('model:"A B"')
  })
})

describe('addToken / removeToken', () => {
  it('adds a token to the query', () => {
    expect(addToken('europe', { key: 'tag', value: 'prod' })).toBe(
      'tag:prod europe',
    )
  })

  it('does not duplicate an existing token (case-insensitive)', () => {
    expect(addToken('tag:prod', { key: 'tag', value: 'PROD' })).toBe('tag:prod')
  })

  it('removes a token from the query', () => {
    expect(removeToken('tag:prod europe', { key: 'tag', value: 'prod' })).toBe(
      'europe',
    )
  })
})
