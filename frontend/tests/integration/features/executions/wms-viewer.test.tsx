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
 * WmsViewer characterization tests.
 *
 * These pin the observable behaviour of the single-lens viewer BEFORE the
 * shared-viewer-core extraction (geo-comparison work) and stay green
 * throughout it. They render against the mock SkinnyWMS servers from
 * mocks/data/wms.data.ts and assert on controls and state — never on
 * rendered map pixels.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import {
  registerMockWmsServer,
  wmsCapabilitiesRequestCount,
} from '@tests/../mocks/data/wms.data'
import WmsViewer from '@/features/executions/components/WmsViewer'
import i18n from '@/lib/i18n'

/** Distinct port per test — server state is registry-keyed, not shared. */
let nextPort = 19700

function registerDefaultServer(): number {
  const port = nextPort++
  registerMockWmsServer(port, {
    layers: [
      {
        name: '2t',
        title: '2 m temperature',
        time: '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z',
      },
      { name: 'msl', title: 'Mean sea level pressure' },
      { name: 'q@pl_500', title: 'Specific humidity at 500 hPa' },
      { name: 'q@pl_850', title: 'Specific humidity at 850 hPa' },
    ],
  })
  return port
}

async function renderViewer(port: number) {
  return await render(
    <I18nextProvider i18n={i18n}>
      {/* Browser-mode tests have no Tailwind CSS — size the host explicitly
          so the OL map has a real viewport. */}
      <div style={{ width: 900, height: 600 }}>
        <WmsViewer baseUrl={`http://localhost:${port}`} />
      </div>
    </I18nextProvider>,
  )
}

describe('WmsViewer', () => {
  it('shows the parameter overview grid parsed from capabilities', async () => {
    const port = registerDefaultServer()
    const screen = await renderViewer(port)

    await expect
      .element(screen.getByText('Pick a parameter to view'))
      .toBeVisible()

    // Surface parameters as single cells.
    await expect.element(screen.getByText('2 m temperature')).toBeVisible()
    await expect
      .element(screen.getByText('Mean sea level pressure'))
      .toBeVisible()

    // Pressure-level variants collapse into one grouped cell with a count.
    await expect.element(screen.getByText('Specific humidity')).toBeVisible()
    await expect.element(screen.getByText('2 levels')).toBeVisible()

    // Decoration layers are repurposed as basemap, never listed as parameters.
    expect(screen.getByText('background').elements()).toHaveLength(0)
  })

  it('adds a surface layer and switches to the populated layout', async () => {
    const port = registerDefaultServer()
    const screen = await renderViewer(port)

    await screen
      .getByRole('button', { name: /2 m temperature/i })
      .first()
      .click()

    // Overview panel gives way to the three-pane layout.
    await expect
      .element(screen.getByText('Pick a parameter to view'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('Active layers')).toBeVisible()
    await expect
      .element(screen.getByPlaceholder('Search layers…'))
      .toBeVisible()

    // The layer advertises two time steps → shared time slider appears.
    await expect.element(screen.getByText('1 / 2')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Next time step' }))
      .toBeEnabled()
  })

  it('steps through time with wraparound', async () => {
    const port = registerDefaultServer()
    const screen = await renderViewer(port)
    await screen
      .getByRole('button', { name: /2 m temperature/i })
      .first()
      .click()

    const next = screen.getByRole('button', { name: 'Next time step' })
    await next.click()
    await expect.element(screen.getByText('2 / 2')).toBeVisible()
    await next.click()
    await expect.element(screen.getByText('1 / 2')).toBeVisible()
  })

  it('adds a pressure-level layer via the level picker popover', async () => {
    const port = registerDefaultServer()
    const screen = await renderViewer(port)

    await screen
      .getByRole('button', { name: /Specific humidity/i })
      .first()
      .click()
    await expect
      .element(screen.getByText('Pick a pressure level'))
      .toBeVisible()
    await screen.getByRole('button', { name: '500 hPa' }).click()

    await expect.element(screen.getByText('Active layers')).toBeVisible()
    await expect
      .element(screen.getByText('Specific humidity at 500 hPa').first())
      .toBeVisible()
  })

  it('retries capabilities when the lens port is not ready yet (503 → 200)', async () => {
    const port = nextPort++
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
      failuresBeforeSuccess: 2,
    })
    const screen = await renderViewer(port)

    // The overview title shows even while loading — wait for real layer
    // content instead. Retry ladder: 300 + 600 ms before the 3rd attempt.
    await expect
      .element(screen.getByText('2 m temperature'), { timeout: 5000 })
      .toBeVisible()
    expect(wmsCapabilitiesRequestCount(port)).toBe(3)
  })
})
