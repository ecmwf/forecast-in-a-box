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
import { parseGlyphContext } from '@/features/fable-builder/utils/glyph-expression-context'

/**
 * Convenience: place the cursor at the `‸` (caret, U+2038) marker in the
 * source string and call the parser. Avoids hand-counting offsets in every
 * test case. The caret cannot appear in Jinja syntax so it never collides
 * with a real `|`, `(`, etc.
 */
function ctx(source: string) {
  const cursor = source.indexOf('‸')
  if (cursor === -1) {
    throw new Error('test input must contain a `‸` cursor marker')
  }
  const text = source.slice(0, cursor) + source.slice(cursor + 1)
  return parseGlyphContext(text, cursor)
}

describe('parseGlyphContext', () => {
  describe('outside a substitution', () => {
    it('returns none for plain text', () => {
      expect(ctx('hello ‸world')).toMatchObject({ kind: 'none' })
    })

    it('returns none after a closed substitution', () => {
      expect(ctx('${var}‸')).toMatchObject({ kind: 'none' })
    })

    it('returns none for empty input', () => {
      expect(ctx('‸')).toMatchObject({ kind: 'none' })
    })
  })

  describe('value position (variables and globals)', () => {
    it('classifies the cursor right after `${` as value', () => {
      expect(ctx('${‸')).toMatchObject({ kind: 'value', prefix: '' })
    })

    it('captures a partial identifier as the prefix', () => {
      const result = ctx('${star‸')
      expect(result.kind).toBe('value')
      expect(result.prefix).toBe('star')
      expect(result.replaceStart).toBe(2) // right after ${
      expect(result.replaceEnd).toBe(6) // cursor offset
    })

    it('skips whitespace immediately after `${`', () => {
      expect(ctx('${ ‸')).toMatchObject({ kind: 'value', prefix: '' })
    })

    it('treats the second substitution as the active one', () => {
      const result = ctx('${first} ${se‸')
      expect(result.kind).toBe('value')
      expect(result.prefix).toBe('se')
    })
  })

  describe('filter position (single pipe)', () => {
    it('classifies right after `|` as filter', () => {
      expect(ctx('${var | ‸')).toMatchObject({ kind: 'filter', prefix: '' })
    })

    it('captures the partial filter name', () => {
      const result = ctx('${startDatetime | sub_d‸')
      expect(result.kind).toBe('filter')
      expect(result.prefix).toBe('sub_d')
    })

    it('handles a pipe with no surrounding whitespace', () => {
      expect(ctx('${var|f‸')).toMatchObject({ kind: 'filter', prefix: 'f' })
    })
  })

  describe('chained filters', () => {
    it('classifies the position after a second pipe as filter', () => {
      expect(ctx('${var | f1 | ‸')).toMatchObject({
        kind: 'filter',
        prefix: '',
      })
    })

    it('captures a partial second filter name', () => {
      const result = ctx('${var | f1 | f2‸')
      expect(result.kind).toBe('filter')
      expect(result.prefix).toBe('f2')
    })
  })

  describe('function-call argument position', () => {
    it('classifies right after `(` as value', () => {
      expect(ctx('${func(‸')).toMatchObject({ kind: 'value', prefix: '' })
    })

    it('classifies right after `,` as value', () => {
      expect(ctx('${func(a, ‸')).toMatchObject({ kind: 'value', prefix: '' })
    })

    it('classifies a pipe inside a function arg as filter', () => {
      const result = ctx('${func(x | f‸')
      expect(result.kind).toBe('filter')
      expect(result.prefix).toBe('f')
    })

    it('returns to outer-frame state after a closing `)`', () => {
      // After `f(x)` the outer frame is "closed" (filter applied to a value);
      // a following pipe re-opens filter context.
      expect(ctx('${func(x) | ‸')).toMatchObject({
        kind: 'filter',
        prefix: '',
      })
    })
  })

  describe('string literals', () => {
    it('returns none when the cursor sits inside a single-quoted string', () => {
      expect(ctx('${func("hello, ‸')).toMatchObject({ kind: 'none' })
    })

    it('skips past a closed string literal and continues classifying', () => {
      const result = ctx('${func("a", b‸')
      expect(result.kind).toBe('value')
      expect(result.prefix).toBe('b')
    })

    it('handles backslash-escaped quotes inside a string', () => {
      const result = ctx('${func("a\\"b", c‸')
      expect(result.kind).toBe('value')
      expect(result.prefix).toBe('c')
    })
  })

  describe('rejected positions', () => {
    it('returns none in the middle of a closed substitution after the identifier', () => {
      // `${var ` → after the identifier and a space, with no separator,
      // there's no candidate set to suggest.
      expect(ctx('${var ‸')).toMatchObject({ kind: 'none' })
    })

    it('returns none for nested substitutions', () => {
      expect(ctx('${func(${inner‸')).toMatchObject({ kind: 'none' })
    })

    it('returns none for two adjacent identifiers separated by whitespace', () => {
      // `${a b` is invalid Jinja and should not surface autocomplete.
      expect(ctx('${a b‸')).toMatchObject({ kind: 'none' })
    })

    it('returns none for an unrecognised char like `.` after an identifier', () => {
      expect(ctx('${var.field‸')).toMatchObject({ kind: 'none' })
    })
  })

  describe('replace range', () => {
    it('uses cursor for both ends when no prefix exists', () => {
      const text = '${'
      const result = parseGlyphContext(text, text.length)
      expect(result).toMatchObject({
        kind: 'value',
        prefix: '',
        replaceStart: 2,
        replaceEnd: 2,
      })
    })

    it('captures the full prefix range for filter completions', () => {
      const text = '${dt | add_d'
      const result = parseGlyphContext(text, text.length)
      expect(result.replaceStart).toBe(text.indexOf('add_d'))
      expect(result.replaceEnd).toBe(text.length)
      expect(result.kind).toBe('filter')
      expect(result.prefix).toBe('add_d')
    })
  })
})
