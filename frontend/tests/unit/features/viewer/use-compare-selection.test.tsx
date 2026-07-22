/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Referential-stability contract of useCompareSelection: consumers hang
 * memos and effects (time-index expansion, layer-stack reconciles, the
 * prefetch loop) off the returned identities, so linked-mode projections
 * must not be rebuilt on unrelated re-renders.
 */

import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CompareSelection } from '@/features/viewer/geo/useCompareSelection'
import type { PairedLayer } from '@/features/viewer/geo/layer-pairing'
import { useCompareSelection } from '@/features/viewer/geo/useCompareSelection'

const layer = (name: string, title: string) => ({
  name,
  title,
  styles: [],
})

const PAIRS: ReadonlyArray<PairedLayer> = [
  {
    key: '2 m temperature@sfc',
    title: '2 m temperature',
    subtitle: null,
    level: null,
    levelUnit: null,
    perSource: { a: layer('2t', '2 m temperature'), b: layer('2t', '2t') },
  },
  {
    key: 'Mean sea level pressure@sfc',
    title: 'Mean sea level pressure',
    subtitle: null,
    level: null,
    levelUnit: null,
    perSource: { a: layer('msl', 'Mean sea level pressure') },
  },
]

function Probe({
  onRender,
}: {
  onRender: (selection: CompareSelection) => void
}) {
  const [, setNonce] = useState(0)
  const selection = useCompareSelection(PAIRS)
  onRender(selection)
  return (
    <>
      <button type="button" onClick={() => setNonce((n) => n + 1)}>
        rerender
      </button>
      <button
        type="button"
        onClick={() => selection.togglePair('2 m temperature@sfc')}
      >
        toggle
      </button>
    </>
  )
}

describe('useCompareSelection identity stability', () => {
  it('keeps linked-mode projections referentially stable across unrelated re-renders', async () => {
    const snapshots: Array<{
      order: ReadonlyArray<string>
      opacities: ReadonlyMap<string, number>
    }> = []
    const screen = await render(
      <Probe
        onRender={(selection) =>
          snapshots.push({
            order: selection.activeOrderFor('a'),
            opacities: selection.opacitiesFor('a'),
          })
        }
      />,
    )
    await screen.getByRole('button', { name: 'toggle' }).click()
    const first = snapshots.at(-1)!
    expect(first.order).toEqual(['2t'])

    await screen.getByRole('button', { name: 'rerender' }).click()
    const second = snapshots.at(-1)!
    expect(snapshots.length).toBeGreaterThan(1)
    expect(second.order).toBe(first.order)
    expect(second.opacities).toBe(first.opacities)
  })

  it('changes projection identity when the selection actually changes', async () => {
    const orders: Array<ReadonlyArray<string>> = []
    const screen = await render(
      <Probe
        onRender={(selection) => orders.push(selection.activeOrderFor('a'))}
      />,
    )
    const before = orders.at(-1)!
    expect(before).toEqual([])

    await screen.getByRole('button', { name: 'toggle' }).click()
    expect(orders.at(-1)).not.toBe(before)
    expect(orders.at(-1)).toEqual(['2t'])
  })
})
