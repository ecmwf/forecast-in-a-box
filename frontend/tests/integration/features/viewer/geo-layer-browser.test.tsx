/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Layer-browser empty states: loading, capabilities error (with retry),
 *  and genuine no-match — a failed catalog must never look like an empty
 *  search. */

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import type { LensSource } from '@/features/viewer/hooks/useLensSource'
import { GeoLayerBrowser } from '@/features/viewer/geo/GeoLayerBrowser'
import { buildPairs } from '@/features/viewer/geo/layer-pairing'
import { groupLayers } from '@/features/viewer/wms-capabilities'
import { useCompareSelection } from '@/features/viewer/geo/useCompareSelection'
import i18n from '@/lib/i18n'

function lensSource(overrides: Partial<LensSource> = {}): LensSource {
  return {
    layers: [],
    decorationLayers: [],
    bbox: null,
    error: null,
    loadingLayers: false,
    retrying: false,
    groups: [],
    retry: () => {},
    ...overrides,
  }
}

function Harness({
  sourceA,
  sourceB = lensSource(),
  hasB = false,
  focusSlot = null,
}: {
  sourceA: LensSource
  sourceB?: LensSource
  hasB?: boolean
  focusSlot?: 'a' | null
}) {
  const pairing = buildPairs(sourceA.groups, sourceB.groups)
  const selection = useCompareSelection(pairing.pairs)
  return (
    <I18nextProvider i18n={i18n}>
      <GeoLayerBrowser
        hasB={hasB}
        focusSlot={focusSlot}
        pairs={pairing.pairs}
        selection={selection}
        sourceA={sourceA}
        sourceB={sourceB}
        onCollapse={() => {}}
      />
    </I18nextProvider>
  )
}

describe('GeoLayerBrowser empty states', () => {
  it('shows the capabilities error with a working Retry (linked view)', async () => {
    const retry = vi.fn()
    const screen = await render(
      <Harness sourceA={lensSource({ error: 'GetCapabilities 503', retry })} />,
    )

    await expect
      .element(screen.getByText(/Could not load this server's layers/))
      .toBeVisible()
    await expect.element(screen.getByText(/GetCapabilities 503/)).toBeVisible()
    await screen.getByRole('button', { name: 'Retry' }).click()
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.getByText('Nothing matches the search.').elements()).toEqual(
      [],
    )
  })

  it('shows the error in the focused per-source view too', async () => {
    const screen = await render(
      <Harness
        focusSlot="a"
        sourceA={lensSource({ error: 'Failed to fetch' })}
      />,
    )
    await expect
      .element(screen.getByText(/Could not load this server's layers/))
      .toBeVisible()
  })

  it('drops a stale B slot filter when B is removed (swap + X flow)', async () => {
    const mk = (name: string, title: string) => ({ name, title, styles: [] })
    const a = lensSource({
      layers: [mk('2t', '2 m temperature')],
      groups: groupLayers([mk('2t', '2 m temperature')]),
    })
    const b = lensSource({
      layers: [mk('msl', 'MSL pressure')],
      groups: groupLayers([mk('msl', 'MSL pressure')]),
    })
    const screen = await render(<Harness sourceA={a} sourceB={b} hasB />)

    await screen.getByRole('button', { name: 'B', exact: true }).click()
    await expect.element(screen.getByText('MSL pressure')).toBeVisible()
    expect(screen.getByText('2 m temperature').elements()).toHaveLength(0)

    // B leaves; the stale 'b' filter must not empty A's catalog.
    await screen.rerender(
      <Harness sourceA={a} sourceB={lensSource()} hasB={false} />,
    )
    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    expect(
      screen.getByText('Nothing matches the search.').elements(),
    ).toHaveLength(0)
  })

  it('keeps loading and no-match states distinct', async () => {
    const loading = await render(
      <Harness sourceA={lensSource({ loadingLayers: true })} />,
    )
    await expect.element(loading.getByText('Loading layers…')).toBeVisible()

    const empty = await render(<Harness sourceA={lensSource()} />)
    await expect
      .element(empty.getByText('Nothing matches the search.'))
      .toBeVisible()
  })
})
