/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import { CuratedWmsList } from '@/features/visualise/components/sources/CuratedWmsList'
import { CURATED_WMS_SERVERS } from '@/features/visualise/curated-wms'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'
import i18n from '@/lib/i18n'

vi.mock('@/features/visualise/wms-probe', () => ({
  probeWmsEndpoint: vi.fn((url: string) =>
    Promise.resolve(
      url.includes('victoria')
        ? { ok: false as const, reason: 'unreachable' as const }
        : {
            ok: true as const,
            baseUrl: new URL(url).toString(),
            label: 'probed-host',
          },
    ),
  ),
}))

function renderList() {
  return render(
    <I18nextProvider i18n={i18n}>
      <CuratedWmsList />
    </I18nextProvider>,
  )
}

describe('CuratedWmsList', () => {
  it('lists every curated server with its host', async () => {
    const screen = await renderList()
    for (const server of CURATED_WMS_SERVERS.slice(0, 3)) {
      await expect
        .element(screen.getByText(server.name, { exact: true }))
        .toBeVisible()
    }
    await expect.element(screen.getByText('eccharts.ecmwf.int')).toBeVisible()
    expect(screen.getByRole('button', { name: /add/i }).elements()).toHaveLength(
      CURATED_WMS_SERVERS.length,
    )
  })

  it('probes and adds with the curated name as label', async () => {
    const screen = await renderList()
    const row = screen
      .getByText('ECMWF', { exact: true })
      .element()
      .closest('li')!
    ;(row.querySelector('button') as HTMLButtonElement).click()

    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toEqual([
        expect.objectContaining({ kind: 'wms', label: 'ECMWF' }),
      ])
    // The row flips to a disabled "Added" state.
    await expect
      .element(screen.getByRole('button', { name: /added/i }))
      .toBeDisabled()
  })

  it('shows a checking hint while the probe runs', async () => {
    const { probeWmsEndpoint } = await import('@/features/visualise/wms-probe')
    let settle!: (v: unknown) => void
    vi.mocked(probeWmsEndpoint).mockImplementationOnce(
      () => new Promise((r) => (settle = r)) as never,
    )
    const screen = await renderList()
    const row = screen
      .getByText('EUMETSAT', { exact: true })
      .element()
      .closest('li')!
    ;(row.querySelector('button') as HTMLButtonElement).click()

    await expect
      .element(screen.getByText('Checking WMS capabilities…'))
      .toBeVisible()
    settle({ ok: false, reason: 'timeout' })
    await expect
      .poll(() => (row.querySelector('button') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('keeps the basket unchanged when the probe fails', async () => {
    const screen = await renderList()
    const row = screen.getByText('Victoria WMS').element().closest('li')!
    ;(row.querySelector('button') as HTMLButtonElement).click()

    // Probe settles; nothing added, button usable again.
    await expect
      .poll(() =>
        (row.querySelector('button') as HTMLButtonElement).disabled,
      )
      .toBe(false)
    expect(useComparisonStore.getState().entries).toHaveLength(0)
  })
})
