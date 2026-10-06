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
 * GeoViewer <-> 3D globe wiring through the engine seam: a fake engine
 * stands in for MapLibre (headless WebGL is not guaranteed), so these
 * assert gating, handoff, and what reaches the engine — not pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import axe from 'axe-core'
import { engineCalls } from './globe-engine-mock'
import { Harness, injectMapSizing, registerServer } from './globe-harness'
import type { ViewerUrlState } from '@/features/viewer/geo/view-url-state'
import { NAV_ZOOM_STEP } from '@/features/viewer/geo/map-nav'

vi.mock(
  '@/features/viewer/globe/webgl-support',
  async () => (await import('./globe-engine-mock')).webglSupportMock,
)
vi.mock(
  '@/features/viewer/globe/engine-entry',
  async () => (await import('./globe-engine-mock')).engineEntryMock,
)

describe('GeoViewer 3D globe', () => {
  let removeSizing = () => {}
  beforeEach(() => {
    removeSizing = injectMapSizing()
  })
  afterEach(() => removeSizing())

  it('bends into the globe with the active stack and flattens back', async () => {
    const portA = registerServer()
    const screen = await render(<Harness portA={portA} />)
    await screen.getByText('2 m temperature').first().click()

    await screen.getByRole('button', { name: 'Projection & basemap' }).click()
    // Opening the menu warms the globe: mounted, hidden, before any choice.
    await expect.element(screen.getByTestId('globe-canvas')).toBeInTheDocument()
    // Warm is not live: no data fetches until the globe is entered.
    await expect.poll(() => engineCalls.live.at(-1)).toBe(false)
    // Hidden, it is out of the tab order and the a11y tree.
    await expect
      .element(screen.getByTestId('globe-view'))
      .toHaveAttribute('inert')
    const seeds = engineCalls.seeds.length
    await screen.getByRole('radio', { name: /^3D globe/ }).click()

    // The bend is asked for (the unstyled test map has no pixels to seed).
    await expect
      .poll(() => engineCalls.seeds.length, { timeout: 5000 })
      .toBe(seeds + 1)
    // Server-drawn symbols are squeezed on the globe; an info icon says so.
    await expect
      .element(
        screen.getByRole('button', { name: 'About symbols on the globe' }),
      )
      .toHaveAccessibleDescription(
        /directions are approximate at high latitudes/,
      )
    // Done with the menu: close it, so it covers none of the panel's controls.
    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByRole('radio', { name: /^3D globe/ }))
      .not.toBeInTheDocument()
    expect(engineCalls.live.at(-1)).toBe(true)
    await expect
      .element(screen.getByTestId('globe-view'))
      .not.toHaveAttribute('inert')
    await expect
      .poll(() => engineCalls.layers.at(-1)?.map((s) => s.params.LAYERS))
      .toEqual(['2t'])
    expect(engineCalls.layers.at(-1)?.[0].time).toBe('2026-07-06T00:00:00Z')
    // Map-click tools have no globe counterpart.
    await expect
      .element(screen.getByRole('button', { name: 'Measure distance' }))
      .toBeDisabled()
    // Disabled buttons get no hover: their group carries the reason.
    await expect
      .element(screen.getByTitle('Not available on the 3D globe'))
      .toContainElement(
        screen.getByRole('button', { name: 'Measure distance' }).element(),
      )
    // The panel is a named region with the flat maps' non-drag controls.
    const panel = screen.getByRole('region', { name: '3D globe, source A' })
    await expect.element(panel).toBeInTheDocument()
    const zoomBefore = engineCalls.camera().zoom
    const zoom = panel.getByRole('group', { name: 'Zoom' })
    // Assistive tech learns the keys that do the same.
    await expect
      .element(zoom.getByRole('button', { name: 'Zoom in' }))
      .toHaveAttribute('aria-keyshortcuts', 'plus =')
    // Unstyled test layout never settles for Playwright's stability check.
    await zoom.getByRole('button', { name: 'Zoom in' }).click({ force: true })
    await expect
      .poll(() => engineCalls.camera().zoom)
      .toBeCloseTo(zoomBefore + NAV_ZOOM_STEP, 6)
    const lonBefore = engineCalls.camera().lon
    await panel
      .getByRole('group', { name: 'Pan' })
      .getByRole('button', { name: 'Pan right' })
      .click({ force: true })
    await expect.poll(() => engineCalls.camera().lon).toBeGreaterThan(lonBefore)
    // The - key zooms the globe too, by the same step.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', bubbles: true }),
    )
    await expect
      .poll(() => engineCalls.camera().zoom)
      .toBeCloseTo(zoomBefore, 6)

    // P cycles projections: from the globe, back to Web Mercator.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }),
    )
    // Back on the flat map the globe stays warm: hidden, not torn down.
    await expect
      .element(screen.getByTestId('globe-view'))
      .toHaveStyle({ opacity: '0' })
    await expect
      .element(screen.getByTestId('globe-view'))
      .toHaveAttribute('inert')
    expect(engineCalls.destroyed).toBe(0)
    await expect.poll(() => engineCalls.live.at(-1)).toBe(false)
  })

  it('warms the globe with the chosen basemap under a lat/lon map', async () => {
    const screen = await render(
      <Harness
        portA={registerServer()}
        initialViewState={{ projection: 'geo' }}
      />,
    )
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()
    await screen.getByRole('button', { name: 'Projection & basemap' }).click()
    await expect.element(screen.getByTestId('globe-canvas')).toBeInTheDocument()
    // The flat map falls back to the outline; the globe must not switch style mid-bend.
    await expect.poll(() => engineCalls.basemaps.at(-1)?.kind).toBe('vector')
  })

  it('re-renders the viewer on zoom steps, not on every drag frame', async () => {
    const screen = await render(
      <Harness
        portA={registerServer()}
        initialViewState={{
          projection: 'globe',
          camera: { lon: 12, lat: 48, zoom: 2 },
        }}
      />,
    )
    await expect.element(screen.getByTestId('globe-canvas')).toBeInTheDocument()
    await expect.poll(() => engineCalls.events).not.toBeNull()
    await new Promise((r) => setTimeout(r, 500))
    const before = engineCalls.commits
    // A drag north: the measured zoom drifts a little every frame.
    for (let i = 1; i <= 30; i++) {
      engineCalls.events!.onCameraChange({
        lon: 12,
        lat: 48 + i * 0.05,
        zoom: 2 + i * 0.001,
      })
      await new Promise((r) => requestAnimationFrame(r))
    }
    await new Promise((r) => setTimeout(r, 300))
    expect(engineCalls.commits - before).toBeLessThan(5)
  })

  it('keeps the annotate key inert on the globe', async () => {
    const screen = await render(
      <Harness
        portA={registerServer()}
        initialViewState={{
          projection: 'globe',
          camera: { lon: 12, lat: 48, zoom: 2 },
        }}
      />,
    )
    await expect.element(screen.getByTestId('globe-canvas')).toBeInTheDocument()
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', bubbles: true }),
    )
    await new Promise((r) => setTimeout(r, 100))
    await expect
      .element(screen.getByRole('button', { name: /^Annotate/ }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('axe: no serious violations on the globe', async () => {
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
    const results = await axe.run(document.body, {
      // Unstyled test env: colour contrast is meaningless here.
      rules: { 'color-contrast': { enabled: false } },
    })
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(
      serious.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([])
  })

  it('is blocked in single-map comparison modes', async () => {
    const screen = await render(
      <Harness
        portA={registerServer()}
        portB={registerServer()}
        initialMode="swipe"
      />,
    )
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()
    await screen.getByRole('button', { name: 'Projection & basemap' }).click()
    await expect
      .element(screen.getByRole('radio', { name: /3D globe/ }))
      .toBeDisabled()
    await expect
      .element(screen.getByText('Only one source or side-by-side'))
      .toBeVisible()
  })

  it('names a source that cannot serve the world image', async () => {
    const screen = await render(
      <Harness portA={registerServer(['EPSG:3857'])} />,
    )
    await expect
      .element(screen.getByText('2 m temperature').first())
      .toBeVisible()
    await screen.getByRole('button', { name: 'Projection & basemap' }).click()
    const globe = screen.getByRole('radio', { name: /3D globe/ })
    await expect.element(globe).toBeDisabled()
    await expect
      .element(globe.getByText('A · Run A does not serve this projection'))
      .toBeVisible()
  })

  it('restores straight onto the globe and reports its camera', async () => {
    const onViewStateChange =
      vi.fn<(partial: Partial<ViewerUrlState>) => void>()
    const screen = await render(
      <Harness
        portA={registerServer()}
        initialViewState={{
          projection: 'globe',
          camera: { lon: 12, lat: 48, zoom: 2 },
        }}
        onViewStateChange={onViewStateChange}
      />,
    )
    await expect.element(screen.getByTestId('globe-canvas')).toBeInTheDocument()
    await expect
      .poll(() =>
        onViewStateChange.mock.calls.some(
          ([partial]) =>
            partial.camera?.lon === 12 && partial.camera.zoom === 2,
        ),
      )
      .toBe(true)
    expect(onViewStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ projection: 'globe' }),
    )
  })
})
