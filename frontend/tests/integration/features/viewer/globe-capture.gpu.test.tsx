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
 * Globe export capture through the fake engine. Local only (`npm run
 * test:globe`): it flaked on loaded CI runners and never reproduced locally.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { engineCalls } from './globe-engine-mock'
import { Harness, injectMapSizing, registerServer } from './globe-harness'

vi.mock(
  '@/features/viewer/globe/webgl-support',
  async () => (await import('./globe-engine-mock')).webglSupportMock,
)
vi.mock(
  '@/features/viewer/globe/engine-entry',
  async () => (await import('./globe-engine-mock')).engineEntryMock,
)

describe('GeoViewer 3D globe capture', () => {
  let removeSizing = () => {}
  beforeEach(() => {
    removeSizing = injectMapSizing()
  })
  afterEach(() => removeSizing())

  it('captures the globe only once its images are in', async () => {
    const basemapsBefore = engineCalls.basemaps.length
    const screen = await render(
      <Harness
        portA={registerServer()}
        initialViewState={{
          projection: 'globe',
          camera: { lon: 12, lat: 48, zoom: 2 },
        }}
      />,
    )
    await expect
      .element(screen.getByRole('region', { name: '3D globe, source A' }))
      .toBeInTheDocument()
    // The first basemap marks the engine registered after its async mount: C before that captures nothing.
    await expect
      .poll(() => engineCalls.basemaps.length)
      .toBeGreaterThan(basemapsBefore)
    let loaded = () => {}
    engineCalls.loaded = new Promise<void>((resolve) => {
      loaded = resolve
    })
    const before = engineCalls.captures
    // C copies the view: the export capture path.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }),
    )
    await new Promise((r) => setTimeout(r, 300))
    expect(engineCalls.captures).toBe(before)
    loaded()
    await expect.poll(() => engineCalls.captures).toBe(before + 1)
  })
})
