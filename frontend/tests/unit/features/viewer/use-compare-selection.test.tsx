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

describe('useCompareSelection styles', () => {
  const styled = (name: string, styles: Array<string>) => ({
    name,
    title: name,
    styles: styles.map((s) => ({ name: s })),
  })
  const PAIRS_WITH_STYLES: ReadonlyArray<PairedLayer> = [
    {
      key: 'p@sfc',
      title: '2 m temperature',
      subtitle: null,
      level: null,
      levelUnit: null,
      perSource: {
        a: styled('2t', ['sh_x', 'sh_y']),
        b: styled('t2m', ['sh_x']),
      },
    },
  ]
  function StyleProbe({
    onRender,
  }: {
    onRender: (selection: CompareSelection) => void
  }) {
    const selection = useCompareSelection(PAIRS_WITH_STYLES)
    onRender(selection)
    return (
      <>
        <button type="button" onClick={() => selection.togglePair('p@sfc')}>
          toggle
        </button>
        <button
          type="button"
          onClick={() => selection.setPairStyle('p@sfc', 'sh_y')}
        >
          style-y
        </button>
        <button type="button" onClick={() => selection.setLinkMode('unlinked')}>
          unlink
        </button>
        <button type="button" onClick={() => selection.setLinkMode('linked')}>
          link
        </button>
        <button
          type="button"
          onClick={() => selection.setLayerStyle('b', 't2m', 'sh_x')}
        >
          b-style
        </button>
      </>
    )
  }

  it('applies a pair style only to sides that advertise it, across modes', async () => {
    let latest!: CompareSelection
    const screen = await render(
      <StyleProbe
        onRender={(s) => {
          latest = s
        }}
      />,
    )
    await screen.getByRole('button', { name: 'toggle' }).click()
    await screen.getByRole('button', { name: 'style-y' }).click()
    expect(latest.pairStyle('p@sfc')).toBe('sh_y')
    expect(latest.settingsFor('a').get('2t')?.style).toBe('sh_y')
    // B lacks sh_y → keeps its default (no entry).
    expect(latest.settingsFor('b').get('t2m')).toBeUndefined()

    // Unlinked copies the projection; per-side edits then stay per side.
    await screen.getByRole('button', { name: 'unlink' }).click()
    expect(latest.layerStyle('a', '2t')).toBe('sh_y')
    await screen.getByRole('button', { name: 'b-style' }).click()
    expect(latest.layerStyle('b', 't2m')).toBe('sh_x')
    expect(latest.settingsFor('a').get('2t')?.style).toBe('sh_y')

    // Relinking keeps A's choice for the pair.
    await screen.getByRole('button', { name: 'link', exact: true }).click()
    expect(latest.pairStyle('p@sfc')).toBe('sh_y')
  })
})

describe('useCompareSelection default styles', () => {
  const PAIR: ReadonlyArray<PairedLayer> = [
    {
      key: 'p@sfc',
      title: '2 m temperature',
      subtitle: null,
      level: null,
      levelUnit: null,
      perSource: {
        a: { name: '2t', title: '2t', styles: [{ name: 'x' }, { name: 'y' }] },
      },
    },
  ]
  function SeedProbe({
    onRender,
  }: {
    onRender: (selection: CompareSelection) => void
  }) {
    const selection = useCompareSelection(PAIR, {
      defaultStyle: (slot, name) =>
        slot === 'a' && name === '2t' ? 'y' : null,
    })
    onRender(selection)
    return (
      <>
        <button type="button" onClick={() => selection.togglePair('p@sfc')}>
          toggle
        </button>
        <button
          type="button"
          onClick={() => selection.setPairStyle('p@sfc', null)}
        >
          reset
        </button>
      </>
    )
  }

  it('seeds a newly activated pair with the pinned style, once', async () => {
    let latest!: CompareSelection
    const screen = await render(
      <SeedProbe
        onRender={(s) => {
          latest = s
        }}
      />,
    )
    await screen.getByRole('button', { name: 'toggle' }).click()
    expect(latest.pairStyle('p@sfc')).toBe('y')
    // An explicit "back to default" is respected while the pair stays on.
    await screen.getByRole('button', { name: 'reset' }).click()
    expect(latest.pairStyle('p@sfc')).toBeNull()
    // Re-activating seeds again.
    await screen.getByRole('button', { name: 'toggle' }).click()
    await screen.getByRole('button', { name: 'toggle' }).click()
    expect(latest.pairStyle('p@sfc')).toBe('y')
  })
})

describe('useCompareSelection dimensions', () => {
  function DimProbe({
    onRender,
  }: {
    onRender: (selection: CompareSelection) => void
  }) {
    const selection = useCompareSelection(PAIRS)
    onRender(selection)
    return (
      <>
        <button
          type="button"
          onClick={() => selection.togglePair('2 m temperature@sfc')}
        >
          toggle
        </button>
        <button
          type="button"
          onClick={() =>
            selection.setLayerDim(
              'b',
              '2t',
              'reference_time',
              '2026-09-04T00:00:00Z',
            )
          }
        >
          run-b
        </button>
        <button type="button" onClick={() => selection.onSlotsSwapped()}>
          swap
        </button>
      </>
    )
  }

  it('keeps dimension values per side, in linked mode too, and follows a swap', async () => {
    let latest!: CompareSelection
    const screen = await render(
      <DimProbe
        onRender={(s) => {
          latest = s
        }}
      />,
    )
    await screen.getByRole('button', { name: 'toggle' }).click()
    await screen.getByRole('button', { name: 'run-b' }).click()
    expect(latest.settingsFor('b').get('2t')?.dims).toEqual({
      reference_time: '2026-09-04T00:00:00Z',
    })
    expect(latest.settingsFor('a').get('2t')?.dims).toBeUndefined()
    expect(latest.layerDim('b', '2t', 'reference_time')).toBe(
      '2026-09-04T00:00:00Z',
    )
    await screen.getByRole('button', { name: 'swap' }).click()
    expect(latest.layerDim('a', '2t', 'reference_time')).toBe(
      '2026-09-04T00:00:00Z',
    )
    expect(latest.layerDim('b', '2t', 'reference_time')).toBeNull()
  })
})
