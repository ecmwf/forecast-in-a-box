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
  it('returns empty result for empty inputs', () => {
    const result = mapBlockErrorsToFields([])
    expect(result).toEqual({ byConfigKey: {}, unmapped: [] })
  })

  describe('Block contains extra / missing config', () => {
    it('attaches "Unknown configuration key" for extra config', () => {
      const result = mapBlockErrorsToFields([
        "Block contains extra config: {'orphan'}",
      ])
      expect(result.byConfigKey).toEqual({
        orphan: ['Unknown configuration key'],
      })
    })

    it('attaches "Missing required value" for missing config', () => {
      const result = mapBlockErrorsToFields([
        "Block contains missing config: {'needed', 'also_needed'}",
      ])
      expect(result.byConfigKey).toEqual({
        needed: ['Missing required value'],
        also_needed: ['Missing required value'],
      })
    })

    it('falls back to unmapped when the set literal is malformed', () => {
      const result = mapBlockErrorsToFields([
        'Block contains missing config: not-a-set',
      ])
      expect(result.unmapped).toEqual([
        'Block contains missing config: not-a-set',
      ])
    })
  })

  describe('Missing glyphs (structured)', () => {
    it('attaches an unknown-glyph message per (configKey, glyphName) entry', () => {
      const result = mapBlockErrorsToFields([], {
        expver: ['runtd'],
      })
      expect(result.byConfigKey).toEqual({
        expver: ['Unknown glyph: ${runtd}'],
      })
      expect(result.unmapped).toEqual([])
    })

    it('handles multiple glyphs on the same option and multiple options', () => {
      const result = mapBlockErrorsToFields([], {
        fname: ['missingRoot'],
        suffix: ['missingRoot', 'env'],
      })
      expect(result.byConfigKey).toEqual({
        fname: ['Unknown glyph: ${missingRoot}'],
        suffix: ['Unknown glyph: ${missingRoot}', 'Unknown glyph: ${env}'],
      })
    })

    it('treats an empty missingGlyphs map as a no-op', () => {
      const result = mapBlockErrorsToFields([], {})
      expect(result).toEqual({ byConfigKey: {}, unmapped: [] })
    })
  })

  it('passes through unrecognised errors as unmapped', () => {
    const result = mapBlockErrorsToFields([
      'Plugin not found',
      'BlockFactory not found in the catalogue',
    ])
    expect(result.byConfigKey).toEqual({})
    expect(result.unmapped).toEqual([
      'Plugin not found',
      'BlockFactory not found in the catalogue',
    ])
  })

  it('combines parsed errors, structured missing glyphs, and unmapped errors', () => {
    const result = mapBlockErrorsToFields(
      ["Block contains missing config: {'date'}", 'Plugin not found'],
      { expver: ['runtd'] },
    )
    expect(result.byConfigKey).toEqual({
      date: ['Missing required value'],
      expver: ['Unknown glyph: ${runtd}'],
    })
    expect(result.unmapped).toEqual(['Plugin not found'])
  })
})
