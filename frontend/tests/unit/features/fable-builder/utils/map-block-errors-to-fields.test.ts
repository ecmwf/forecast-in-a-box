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
import { mapBlockErrorsToFields } from '@/features/fable-builder/utils/map-block-errors-to-fields'

describe('mapBlockErrorsToFields', () => {
  it('returns empty result for empty errors', () => {
    const result = mapBlockErrorsToFields([], { foo: 'bar' })
    expect(result).toEqual({ byConfigKey: {}, unmapped: [] })
  })

  describe('Unknown glyphs referenced', () => {
    it('attaches unknown glyph to matching config key', () => {
      const result = mapBlockErrorsToFields(
        ["Unknown glyphs referenced: {'runtd'}"],
        { expver: '${runtd}', date: '2026-04-15' },
      )
      expect(result.byConfigKey).toEqual({
        expver: ['Unknown glyph: ${runtd}'],
      })
      expect(result.unmapped).toEqual([])
    })

    it('attaches to every config key that references an unknown glyph', () => {
      const result = mapBlockErrorsToFields(
        ["Unknown glyphs referenced: {'foo'}"],
        { a: 'prefix-${foo}', b: '${foo}-suffix', c: 'plain' },
      )
      expect(result.byConfigKey).toEqual({
        a: ['Unknown glyph: ${foo}'],
        b: ['Unknown glyph: ${foo}'],
      })
    })

    it('handles multiple unknown glyphs in one error', () => {
      const result = mapBlockErrorsToFields(
        ["Unknown glyphs referenced: {'foo', 'bar'}"],
        { a: '${foo}', b: '${bar}', c: '${foo}-${bar}' },
      )
      expect(result.byConfigKey).toEqual({
        a: ['Unknown glyph: ${foo}'],
        b: ['Unknown glyph: ${bar}'],
        c: ['Unknown glyph: ${foo}', 'Unknown glyph: ${bar}'],
      })
    })

    it('falls back to unmapped when no config value references the unknown glyph', () => {
      const result = mapBlockErrorsToFields(
        ["Unknown glyphs referenced: {'ghost'}"],
        { expver: '${runId}' },
      )
      expect(result.byConfigKey).toEqual({})
      expect(result.unmapped).toEqual(["Unknown glyphs referenced: {'ghost'}"])
    })

    it('falls back to unmapped when the set literal is malformed', () => {
      const result = mapBlockErrorsToFields(
        ['Unknown glyphs referenced: not-a-set'],
        { expver: '${runtd}' },
      )
      expect(result.unmapped).toEqual(['Unknown glyphs referenced: not-a-set'])
    })
  })

  describe('Block contains extra / missing config', () => {
    it('attaches "Unknown configuration key" for extra config', () => {
      const result = mapBlockErrorsToFields(
        ["Block contains extra config: {'orphan'}"],
        {},
      )
      expect(result.byConfigKey).toEqual({
        orphan: ['Unknown configuration key'],
      })
    })

    it('attaches "Missing required value" for missing config', () => {
      const result = mapBlockErrorsToFields(
        ["Block contains missing config: {'needed', 'also_needed'}"],
        {},
      )
      expect(result.byConfigKey).toEqual({
        needed: ['Missing required value'],
        also_needed: ['Missing required value'],
      })
    })
  })

  it('passes through unrecognised errors as unmapped', () => {
    const result = mapBlockErrorsToFields(
      ['Plugin not found', 'BlockFactory not found in the catalogue'],
      { expver: '${runId}' },
    )
    expect(result.byConfigKey).toEqual({})
    expect(result.unmapped).toEqual([
      'Plugin not found',
      'BlockFactory not found in the catalogue',
    ])
  })

  it('mixes mapped and unmapped in a single call', () => {
    const result = mapBlockErrorsToFields(
      [
        "Unknown glyphs referenced: {'runtd'}",
        'Plugin not found',
        "Block contains missing config: {'date'}",
      ],
      { expver: '${runtd}' },
    )
    expect(result.byConfigKey).toEqual({
      expver: ['Unknown glyph: ${runtd}'],
      date: ['Missing required value'],
    })
    expect(result.unmapped).toEqual(['Plugin not found'])
  })
})
