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
import {
  containsGlyphs,
  extractGlyphKey,
  findGlyphSpans,
  hasUnterminatedGlyph,
  parseGlyphSegments,
} from '@/features/fable-builder/utils/glyph-display'

describe('findGlyphSpans', () => {
  it('finds a simple `${name}` substitution', () => {
    expect(findGlyphSpans('${runId}')).toEqual([{ start: 0, end: 8 }])
  })

  it('returns no spans for plain text', () => {
    expect(findGlyphSpans('plain text')).toEqual([])
  })

  it('finds substitutions with pipe filters', () => {
    const text = '${var | sub_days(2)}'
    expect(findGlyphSpans(text)).toEqual([{ start: 0, end: text.length }])
  })

  it('honours a `}` inside a double-quoted string literal', () => {
    // Without string-awareness, the inner `}` would close the substitution
    // prematurely, leaving `b")}` as plain text.
    const text = '${func("a}b")}'
    expect(findGlyphSpans(text)).toEqual([{ start: 0, end: text.length }])
  })

  it('honours a `}` inside a single-quoted string literal', () => {
    const text = "${func('a}b')}"
    expect(findGlyphSpans(text)).toEqual([{ start: 0, end: text.length }])
  })

  it('handles backslash-escaped quotes inside string literals', () => {
    const text = '${func("a\\"b}c")}'
    expect(findGlyphSpans(text)).toEqual([{ start: 0, end: text.length }])
  })

  it('finds multiple substitutions in one string', () => {
    const text = 'x=${a}, y=${b | f}'
    expect(findGlyphSpans(text)).toEqual([
      { start: 2, end: 6 }, // ${a}
      { start: 10, end: 18 }, // ${b | f}
    ])
  })

  it('skips an unterminated `${`', () => {
    expect(findGlyphSpans('${var | sub')).toEqual([])
  })

  it('returns earlier spans even if a later substitution is unterminated', () => {
    const text = '${good} then ${bad'
    expect(findGlyphSpans(text)).toEqual([{ start: 0, end: 7 }])
  })
})

describe('containsGlyphs', () => {
  it('returns true for a plain `${name}` reference', () => {
    expect(containsGlyphs('${runId}')).toBe(true)
  })

  it('returns true for a Jinja expression with filters', () => {
    expect(containsGlyphs('${submitDatetime | sub_days(2)}')).toBe(true)
  })

  it('returns true even when the body contains a `}` inside a string', () => {
    expect(containsGlyphs('${func("a}b")}')).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(containsGlyphs('hello world')).toBe(false)
  })

  it('returns false for an unterminated `${`', () => {
    expect(containsGlyphs('${var | sub')).toBe(false)
  })
})

describe('parseGlyphSegments', () => {
  it('treats a complete expression as a single glyph segment', () => {
    expect(parseGlyphSegments('${var | sub_days(2)}')).toEqual([
      { text: '${var | sub_days(2)}', isGlyph: true },
    ])
  })

  it('splits text and glyph segments correctly', () => {
    expect(parseGlyphSegments('/data/${runId}/output')).toEqual([
      { text: '/data/', isGlyph: false },
      { text: '${runId}', isGlyph: true },
      { text: '/output', isGlyph: false },
    ])
  })

  it('keeps `}` inside string literals as part of the glyph segment', () => {
    expect(parseGlyphSegments('prefix ${func("a}b")} suffix')).toEqual([
      { text: 'prefix ', isGlyph: false },
      { text: '${func("a}b")}', isGlyph: true },
      { text: ' suffix', isGlyph: false },
    ])
  })
})

describe('extractGlyphKey', () => {
  it('returns the variable name for a plain reference', () => {
    expect(extractGlyphKey('${runId}')).toBe('runId')
  })

  it('returns the full inner body for a Jinja expression', () => {
    expect(extractGlyphKey('${var | sub_days(2)}')).toBe('var | sub_days(2)')
  })
})

describe('hasUnterminatedGlyph', () => {
  it('returns false for a balanced expression', () => {
    expect(hasUnterminatedGlyph('${var}')).toBe(false)
    expect(hasUnterminatedGlyph('${var | sub_days(2)}')).toBe(false)
  })

  it('returns true for the bare opener inserted by the glyph toggle', () => {
    expect(hasUnterminatedGlyph('${')).toBe(true)
  })

  it('returns true for partial variable names still being typed', () => {
    expect(hasUnterminatedGlyph('${sub')).toBe(true)
    expect(hasUnterminatedGlyph('${var | sub_d')).toBe(true)
  })

  it('returns true when only one of two expressions is closed', () => {
    expect(hasUnterminatedGlyph('${a} and ${b')).toBe(true)
  })

  it('does not mistake a `}` inside a string literal for a closer', () => {
    expect(hasUnterminatedGlyph('${func("a}b"')).toBe(true)
    expect(hasUnterminatedGlyph('${func("a}b")}')).toBe(false)
  })

  it('returns false for plain text without any substitution', () => {
    expect(hasUnterminatedGlyph('2026-04-20')).toBe(false)
    expect(hasUnterminatedGlyph('')).toBe(false)
  })
})
