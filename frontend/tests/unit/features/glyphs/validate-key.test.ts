/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { isValidGlyphKey } from '@/features/glyphs/utils/validate-key'

describe('isValidGlyphKey', () => {
  it.each([
    'a',
    'A',
    '_',
    '_x',
    'foo',
    'fooBar',
    'foo_bar',
    'submitDatetime',
    'yesterday2',
    'a1b2c3',
    '_leading_underscore',
    'CONST_NAME',
  ])('accepts the valid Python identifier %s', (key) => {
    expect(isValidGlyphKey(key)).toBe(true)
  })

  it.each([
    '',
    '1foo',
    'foo-bar',
    'yesterday-alt',
    'foo bar',
    'foo.bar',
    'foo$',
    'foo!',
    'foo bar baz',
    'foo/bar',
    'foo\\bar',
    'foo+bar',
    'foo*bar',
    'foo(bar)',
    'foo,bar',
  ])('rejects the invalid identifier %s', (key) => {
    expect(isValidGlyphKey(key)).toBe(false)
  })
})
