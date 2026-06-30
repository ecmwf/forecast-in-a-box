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
  PRESET_DOMAINS,
  detectMode,
  isAutoDomain,
  isBboxTokens,
  parseBbox,
  serializeBbox,
  serializeNames,
  toggleName,
  tokenize,
} from '@/components/base/fields/fields/geo-domain'

const COUNTRIES = ['Germany', 'France', 'Italy', 'United States']

describe('tokenize / isBboxTokens', () => {
  it('splits, trims and drops blanks', () => {
    expect(tokenize(' Germany ,France,, Italy ')).toEqual([
      'Germany',
      'France',
      'Italy',
    ])
  })

  it('treats exactly four integer tokens as a bbox', () => {
    expect(isBboxTokens(['-10', '30', '35', '60'])).toBe(true)
    expect(isBboxTokens(['-10', '30', '35.5', '60'])).toBe(false) // whole degrees only
    expect(isBboxTokens(['10', '20', '30'])).toBe(false) // too few
    expect(isBboxTokens(['Europe', 'Africa', 'Asia', 'Oceania'])).toBe(false) // 4 names ≠ bbox
    expect(isBboxTokens(['10', '20', 'x', '40'])).toBe(false)
  })
})

describe('bbox round-trip', () => {
  it('parses a numeric bbox to [W, S, E, N] (wire = OL extent order)', () => {
    expect(parseBbox('-10,35,30,60')).toEqual([-10, 35, 30, 60])
  })

  it('returns null for non-bbox values', () => {
    expect(parseBbox('Germany,France')).toBeNull()
    expect(parseBbox('Europe')).toBeNull()
    expect(parseBbox('')).toBeNull()
  })

  it('serializes a bbox, rounding to whole degrees', () => {
    expect(serializeBbox([-9.59999, 30.0, 35.2, 60])).toBe('-10,30,35,60')
  })

  it('round-trips parse(serialize)', () => {
    expect(parseBbox(serializeBbox([-10, 30, 35, 60]))).toEqual([
      -10, 30, 35, 60,
    ])
  })
})

describe('serializeNames', () => {
  it('joins names with commas', () => {
    expect(serializeNames(['Germany', 'France', 'Italy'])).toBe(
      'Germany,France,Italy',
    )
  })
})

describe('toggleName', () => {
  it('appends a name that is not present', () => {
    expect(toggleName(['Germany'], 'France')).toEqual(['Germany', 'France'])
  })

  it('removes a name that is present (case-insensitively)', () => {
    expect(toggleName(['Germany', 'France'], 'germany')).toEqual(['France'])
  })

  it('adds to an empty list', () => {
    expect(toggleName([], 'Germany')).toEqual(['Germany'])
  })
})

describe('detectMode', () => {
  it('detects a drawn bbox', () => {
    expect(detectMode('-10,30,35,60', PRESET_DOMAINS, COUNTRIES)).toBe('bbox')
  })

  it('detects country lists', () => {
    expect(detectMode('Germany,France', PRESET_DOMAINS, COUNTRIES)).toBe(
      'countries',
    )
  })

  it('detects presets case-insensitively', () => {
    expect(detectMode('Mediterranean', PRESET_DOMAINS, COUNTRIES)).toBe(
      'presets',
    )
    expect(detectMode('global', PRESET_DOMAINS, COUNTRIES)).toBe('presets')
  })

  it('treats four named regions as presets, not a bbox', () => {
    expect(
      detectMode('Europe,Africa,Asia,Oceania', PRESET_DOMAINS, COUNTRIES),
    ).toBe('presets')
  })

  it('falls back to raw for glyphs and unknown values', () => {
    expect(detectMode('${region}', PRESET_DOMAINS, COUNTRIES)).toBe('raw')
    expect(detectMode('Atlantis', PRESET_DOMAINS, COUNTRIES)).toBe('raw')
  })

  it('defaults an empty value to the presets tab', () => {
    expect(detectMode('', PRESET_DOMAINS, COUNTRIES)).toBe('presets')
  })

  it('routes the auto sentinel to the presets tab', () => {
    expect(detectMode('auto', PRESET_DOMAINS, COUNTRIES)).toBe('presets')
    expect(detectMode(' Auto ', PRESET_DOMAINS, COUNTRIES)).toBe('presets')
  })
})

describe('isAutoDomain', () => {
  it('matches the exclusive auto sentinel case-insensitively', () => {
    expect(isAutoDomain('auto')).toBe(true)
    expect(isAutoDomain(' Auto ')).toBe(true)
    expect(isAutoDomain('auto,Germany')).toBe(false)
    expect(isAutoDomain('')).toBe(false)
  })
})

