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
import { annotationVisibleOn } from '@/features/viewer/geo/annotations'

describe('annotationVisibleOn', () => {
  it('single map shows everything', () => {
    expect(annotationVisibleOn({ slot: 'a' }, null)).toBe(true)
    expect(annotationVisibleOn({ slot: 'b' }, null)).toBe(true)
    expect(annotationVisibleOn({ slot: null }, null)).toBe(true)
  })

  it('side-by-side panels show own + shared pins only', () => {
    expect(annotationVisibleOn({ slot: 'a' }, 'a')).toBe(true)
    expect(annotationVisibleOn({ slot: null }, 'a')).toBe(true)
    expect(annotationVisibleOn({ slot: 'b' }, 'a')).toBe(false)
    expect(annotationVisibleOn({ slot: 'a' }, 'b')).toBe(false)
  })
})
