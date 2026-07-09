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
  MERCATOR_MAX_LAT,
  PRESET_DOMAINS,
  boxHandles,
  clampBboxLatitudeForMercator,
  detectMode,
  isAutoDomain,
  isBboxTokens,
  isDegenerateBboxValue,
  moveExtent,
  parseBbox,
  resizeExtent,
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

  it('flags boxes that round to zero width or height as degenerate', () => {
    expect(isDegenerateBboxValue('10,20,10,40')).toBe(true) // zero width
    expect(isDegenerateBboxValue('10,20,30,20')).toBe(true) // zero height
    expect(isDegenerateBboxValue('10,20,30,40')).toBe(false)
    expect(isDegenerateBboxValue('Germany')).toBe(false) // not a bbox at all
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

describe('box editing geometry', () => {
  const WORLD: [number, number, number, number] = [-100, -100, 100, 100]

  it('places 8 handles at the corners then the edge midpoints', () => {
    const handles = boxHandles([0, 0, 10, 20])
    expect(handles).toHaveLength(8)
    expect(handles.slice(0, 4).map((h) => h.role)).toEqual([
      'nw',
      'ne',
      'se',
      'sw',
    ])
    expect(handles.find((h) => h.role === 'nw')).toMatchObject({ x: 0, y: 20 })
    expect(handles.find((h) => h.role === 'e')).toMatchObject({ x: 10, y: 10 })
  })

  it('resizes a single edge from an edge handle', () => {
    // Drag the east edge out to x=30; the other three edges are unchanged.
    expect(resizeExtent([0, 0, 10, 20], 'e', 30, 999, WORLD)).toEqual([
      0, 0, 30, 20,
    ])
  })

  it('resizes both edges from a corner handle', () => {
    // Drag the NW corner to (-5, 25): west → -5, north → 25.
    expect(resizeExtent([0, 0, 10, 20], 'nw', -5, 25, WORLD)).toEqual([
      -5, 0, 10, 25,
    ])
  })

  it('flips (re-normalises) when a handle crosses the opposite edge', () => {
    // Drag the east edge left past the west edge → the box flips.
    expect(resizeExtent([0, 0, 10, 20], 'e', -4, 0, WORLD)).toEqual([
      -4, 0, 0, 20,
    ])
  })

  it('clamps a resized edge to the world bounds', () => {
    expect(resizeExtent([0, 0, 10, 20], 'e', 500, 0, WORLD)).toEqual([
      0, 0, 100, 20,
    ])
  })

  it('translates the whole box by a delta', () => {
    expect(moveExtent([0, 0, 10, 20], 5, -3, WORLD)).toEqual([5, -3, 15, 17])
  })

  it('clamps the translation so the box stays within the world', () => {
    // +200 in x would push the east edge past 100; clamp so it lands on 100.
    expect(moveExtent([0, 0, 10, 20], 200, 0, WORLD)).toEqual([90, 0, 100, 20])
  })
})

describe('clampBboxLatitudeForMercator', () => {
  it('clamps ±90 latitudes to the Web Mercator limit, leaving longitude untouched', () => {
    expect(clampBboxLatitudeForMercator([-180, -90, 180, 90])).toEqual([
      -180,
      -MERCATOR_MAX_LAT,
      180,
      MERCATOR_MAX_LAT,
    ])
  })

  it('leaves an in-range box unchanged', () => {
    expect(clampBboxLatitudeForMercator([-10, 35, 30, 60])).toEqual([
      -10, 35, 30, 60,
    ])
  })

  it('does not reorder an antimeridian box (west>east preserved)', () => {
    expect(clampBboxLatitudeForMercator([170, -10, -170, 10])).toEqual([
      170, -10, -170, 10,
    ])
  })
})
