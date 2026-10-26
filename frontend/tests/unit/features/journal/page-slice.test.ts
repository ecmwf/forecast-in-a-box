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
import { pageSlice } from '@/features/journal/utils/page-slice'

describe('pageSlice', () => {
  const items = Array.from({ length: 23 }, (_, i) => i)

  it('windows the list and reports the page count', () => {
    expect(pageSlice(items, 1, 10)).toEqual({
      items: items.slice(0, 10),
      page: 1,
      totalPages: 3,
    })
    expect(pageSlice(items, 3, 10).items).toEqual([20, 21, 22])
  })

  it('clamps a page that no longer exists after filtering', () => {
    expect(pageSlice(items, 9, 10)).toMatchObject({ page: 3 })
    expect(pageSlice([], 4, 10)).toEqual({ items: [], page: 1, totalPages: 1 })
  })
})
