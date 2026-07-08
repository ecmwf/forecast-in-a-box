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
import { formatArea, formatLength } from '@/features/viewer/hooks/useMeasure'

describe('measure formatting', () => {
  it('formats lengths across scales', () => {
    expect(formatLength(560)).toBe('560 m')
    expect(formatLength(1234)).toBe('1.23 km')
    expect(formatLength(123_456)).toBe('123.5 km')
  })

  it('formats areas across scales', () => {
    expect(formatArea(560)).toBe('560 m²')
    expect(formatArea(420_000)).toBe('0.42 km²')
    expect(formatArea(1_234_000_000)).toBe('1 234 km²')
  })
})
