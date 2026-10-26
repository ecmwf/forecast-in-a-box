/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStableOrder } from '@/components/common/catalogue/useStableOrder'

interface Item {
  name: string
  rank: number
}

const byRank = (a: Item, b: Item) => a.rank - b.rank
const names = (items: Array<Item>) => items.map((i) => i.name)

function render(items: Array<Item>, resetKey: string) {
  return renderHook(
    (props: { items: Array<Item>; resetKey: string }) =>
      useStableOrder(props.items, (i) => i.name, byRank, props.resetKey),
    { initialProps: { items, resetKey } },
  )
}

describe('useStableOrder', () => {
  const initial = [
    { name: 'a', rank: 2 },
    { name: 'b', rank: 1 },
    { name: 'c', rank: 3 },
  ]

  it('sorts on first render', () => {
    const { result } = render(initial, 'k')
    expect(names(result.current)).toEqual(['b', 'a', 'c'])
  })

  it('keeps positions when a sorted value changes under the same key', () => {
    const { result, rerender } = render(initial, 'k')
    rerender({
      items: [{ name: 'a', rank: 2 }, { name: 'b', rank: 9 }, initial[2]],
      resetKey: 'k',
    })
    expect(names(result.current)).toEqual(['b', 'a', 'c'])
  })

  it('re-sorts when the reset key changes', () => {
    const { result, rerender } = render(initial, 'k')
    rerender({
      items: [{ name: 'a', rank: 2 }, { name: 'b', rank: 9 }, initial[2]],
      resetKey: 'k2',
    })
    expect(names(result.current)).toEqual(['a', 'c', 'b'])
  })

  it('appends items that arrive later, in sorted order', () => {
    const { result, rerender } = render([], 'k')
    rerender({ items: initial, resetKey: 'k' })
    expect(names(result.current)).toEqual(['b', 'a', 'c'])
    rerender({ items: [...initial, { name: 'd', rank: 0 }], resetKey: 'k' })
    expect(names(result.current)).toEqual(['b', 'a', 'c', 'd'])
  })
})
