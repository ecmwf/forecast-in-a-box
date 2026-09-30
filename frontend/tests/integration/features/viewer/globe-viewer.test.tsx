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

import { Profiler, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { registerMockWmsServer } from '@tests/../mocks/data/wms.data'
import type {
  GlobeBasemapSpec,
  GlobeCamera,
  GlobeEngine,
  GlobeEngineEvents,
  GlobeLayerSpec,
} from '@/features/viewer/globe/engine'
import type { CompareMode } from '@/features/viewer/geo/types'
import type { ViewerUrlState } from '@/features/viewer/geo/view-url-state'
import { GeoViewer } from '@/features/viewer/geo/GeoViewer'
import { NAV_ZOOM_STEP } from '@/features/viewer/geo/map-nav'
import i18n from '@/lib/i18n'

const engineCalls = vi.hoisted(() => ({
  layers: [] as Array<ReadonlyArray<GlobeLayerSpec>>,
  basemaps: [] as Array<GlobeBasemapSpec>,
  seeds: [] as Array<boolean>,
  live: [] as Array<boolean>,
  mounted: 0,
  destroyed: 0,
  camera: (): GlobeCamera => ({ lon: 0, lat: 0, zoom: 1 }),
  loaded: Promise.resolve(),
  captures: 0,
  events: null as GlobeEngineEvents | null,
  commits: 0,
}))

vi.mock('@/features/viewer/globe/webgl-support', () => ({
  supportsGlobe: () => true,
  disableGlobe: () => {},
}))

vi.mock('@/features/viewer/globe/engine-entry', () => {
  const fakeEngine = (): GlobeEngine => {
    let camera: GlobeCamera = { lon: 0, lat: 0, zoom: 1 }
    let el: HTMLElement | null = null
    return {
      mount: (container, events) => {
        engineCalls.mounted++
        engineCalls.events = events
        el = document.createElement('div')
        el.dataset.testid = 'globe-canvas'
        container.append(el)
        return Promise.resolve()
      },
      setLayers: (specs) => engineCalls.layers.push(specs),
      setBasemap: (spec) => engineCalls.basemaps.push(spec),
      setLive: (live) => engineCalls.live.push(live),
      getCamera: () => camera,
      setCamera: (next) => {
        camera = next
        engineCalls.camera = () => camera
      },
      whenLoaded: () => engineCalls.loaded,
      morphIn: (_from, to, _ms, seed) => {
        camera = to
        engineCalls.seeds.push(seed !== null)
        return Promise.resolve()
      },
      morphOut: () => Promise.resolve(),
      pick: () => null,
      capture: () => {
        engineCalls.captures++
        return document.createElement('canvas')
      },
      drawViewport: () => {},
      size: () => [800, 600],
      destroy: () => {
        engineCalls.destroyed++
        el?.remove()
      },
    }
  }
  return {
    GLOBE_ENGINE: {
      requiredCrs: 'EPSG:4326',
      maxZoom: 6,
      load: () => Promise.resolve(fakeEngine),
    },
  }
})

let nextPort = 19950

function Harness({
  portA,
  portB = null,
  initialMode = 'side',
  initialViewState,
  onViewStateChange,
}: {
  portA: number
  portB?: number | null
  initialMode?: CompareMode
  initialViewState?: ViewerUrlState
  onViewStateChange?: (partial: Partial<ViewerUrlState>) => void
}) {
  const [queryClient] = useState(() => new QueryClient())
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const home = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: function Home() {
        const [mode, setMode] = useState<CompareMode>(initialMode)
        return (
          <div style={{ width: 1100, height: 700 }}>
            <Profiler id="viewer" onRender={() => engineCalls.commits++}>
              <GeoViewer
                a={{
                  id: `run:${portA}`,
                  baseUrl: `http://localhost:${portA}`,
                  label: 'Run A',
                }}
                b={
                  portB === null
                    ? null
                    : {
                        id: `run:${portB}`,
                        baseUrl: `http://localhost:${portB}`,
                        label: 'Run B',
                      }
                }
                mode={mode}
                onModeChange={setMode}
                onHelp={() => {}}
                initialViewState={initialViewState}
                onViewStateChange={onViewStateChange}
              />
            </Profiler>
          </div>
        )
      },
    })
    return createRouter({
      routeTree: rootRoute.addChildren([home]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
  })
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

function registerServer(crs?: Array<string>): number {
  const port = nextPort++
  registerMockWmsServer(port, {
    crs,
    layers: [
      {
        name: '2t',
        title: '2 m temperature',
        time: '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z',
      },
    ],
  })
  return port
}

/** Tests run without Tailwind: give panels a height and pin overlays. */
function injectMapSizing(): () => void {
  const style = document.createElement('style')
  style.textContent = `
      [class*='h-full'][class*='overflow-hidden'][class*='rounded-md'] { position: relative; height: 400px; }
      [class*='absolute'][class*='inset-0'] { position: absolute; inset: 0; }
      [data-globe-panel] { position: relative; height: 400px; }
      [class*='absolute'][class*='top-2'][class*='right-2'] { position: absolute; top: 8px; right: 8px; z-index: 10; }
      [class~='pointer-events-none'] { pointer-events: none; }
    `
  document.head.append(style)
  return () => style.remove()
}

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
        screen.getByRole('button', {
          name: /directions are approximate at high latitudes/,
        }),
      )
      .toBeInTheDocument()
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
    // The panel is a named region with the flat maps' non-drag controls.
    const panel = screen.getByRole('region', { name: '3D globe, source A' })
    await expect.element(panel).toBeInTheDocument()
    const zoomBefore = engineCalls.camera().zoom
    const zoom = panel.getByRole('group', { name: 'Zoom' })
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
      engineCalls.events!.onCameraChange(
        { lon: 12, lat: 48 + i * 0.05, zoom: 2 + i * 0.001 },
        'user',
      )
      await new Promise((r) => requestAnimationFrame(r))
    }
    await new Promise((r) => setTimeout(r, 300))
    expect(engineCalls.commits - before).toBeLessThan(5)
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

  it('captures the globe only once its images are in', async () => {
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
