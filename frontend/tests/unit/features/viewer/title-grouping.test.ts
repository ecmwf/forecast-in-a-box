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
import { groupByTitlePrefix } from '@/features/viewer/geo/title-grouping'

const titled = (titles: Array<string>) => titles.map((title) => ({ title }))

describe('groupByTitlePrefix', () => {
  it('clusters runs of three or more sharing leading words', () => {
    const groups = groupByTitlePrefix(
      titled([
        'Air temperature 2m indexed',
        'Air temperature 2m max',
        'Air temperature pl in AIFS',
        'Wind speed 10m',
      ]),
      (x) => x.title,
    )
    expect(groups.map((g) => g.prefix)).toEqual(['Air temperature', null])
    expect(groups[0].items.map((i) => i.shortTitle)).toEqual([
      '2m indexed',
      '2m max',
      'pl in AIFS',
    ])
    expect(groups[1].items[0].shortTitle).toBe('Wind speed 10m')
  })

  it('keeps short runs flat', () => {
    const groups = groupByTitlePrefix(
      titled(['Air temperature 2m', 'Air temperature pl', 'Wind speed']),
      (x) => x.title,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].prefix).toBeNull()
  })

  it('only groups at word boundaries', () => {
    const groups = groupByTitlePrefix(
      titled(['Airmass', 'Air temperature 2m', 'Air temperature pl', 'Air quality']),
      (x) => x.title,
    )
    // "Air" prefixes three titles, but "Airmass" must not join them.
    const air = groups.find((g) => g.prefix === 'Air')
    expect(air?.items.map((i) => i.shortTitle)).toEqual([
      'quality',
      'temperature 2m',
      'temperature pl',
    ])
    expect(
      groups.flatMap((g) => (g.prefix === null ? g.items : [])).map((i) => i.shortTitle),
    ).toContain('Airmass')
  })

  it('falls back to the full title when the suffix would be empty', () => {
    const groups = groupByTitlePrefix(
      titled(['Total precipitation', 'Total precipitation 6h', 'Total precipitation 12h']),
      (x) => x.title,
    )
    expect(groups[0].prefix).toBe('Total precipitation')
    expect(groups[0].items.map((i) => i.shortTitle)).toEqual([
      'Total precipitation',
      '12h',
      '6h',
    ])
  })
})
