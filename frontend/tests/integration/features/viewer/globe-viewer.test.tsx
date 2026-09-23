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
 * GeoViewer ↔ 3D globe wiring through the engine seam: a fake engine
 * stands in for three.js (headless WebGL is not guaranteed), so these
 * assert gating, handoff, and what reaches the engine — not pixels.
 */

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
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
  GlobeCamera,
  GlobeEngine,
  GlobeLayerSpec,
} from '@/features/viewer/globe/engine'
import type { CompareMode } from '@/features/viewer/geo/types'
import type { ViewerUrlState } from '@/features/viewer/geo/view-url-state'
import { GeoViewer } from '@/features/viewer/geo/GeoViewer'
import i18n from '@/lib/i18n'

const engineCalls = vi.hoisted(() => ({
  layers: [] as Array<ReadonlyArray<GlobeLayerSpec>>,
  mounted: 0,
  destroyed: 0,
}))

vi.mock('@/features/viewer/globe/webgl-support', () => ({
  supportsGlobe: () => true,
  disableGlobe: () => {},
}))

vi.mock('@/features/viewer/globe/engines/registry', () => {
  const fakeEngine = (): GlobeEngine => {
    let camera: GlobeCamera = { lon: 0, lat: 0, zoom: 1 }
    let el: HTMLElement | null = null
    return {
      mount: (container) => {
        engineCalls.mounted++
        el = document.createElement('div')
        el.dataset.testid = 'globe-canvas'
        container.append(el)
        return Promise.resolve()
      },
      setLayers: (specs) => engineCalls.layers.push(specs),
      setOutline: () => {},
      getCamera: () => camera,
      setCamera: (next) => {
        camera = next
      },
      whenLoaded: () => Promise.resolve(),
      morphIn: (_from, to) => {
        camera = to
        return Promise.resolve()
      },
      morphOut: () => Promise.resolve(),
      pick: () => null,
      capture: () => document.createElement('canvas'),
      size: () => [800, 600],
      destroy: () => {
        engineCalls.destroyed++
        el?.remove()
      },
    }
  }
  const entry = {
    requiredCrs: 'EPSG:4326',
    capabilities: {
      morphFrom: ['merc', 'geo'],
      poles: true,
      minZoom: -2,
      maxZoom: 6,
    },
    load: () => Promise.resolve(fakeEngine),
  }
  return { GLOBE_ENGINES: { three: entry }, ACTIVE_GLOBE_ENGINE: entry }
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

describe('GeoViewer 3D globe', () => {
  it('bends into the globe with the active stack and flattens back', async () => {
    const portA = registerServer()
    const screen = await render(<Harness portA={portA} />)
    await screen.getByText('2 m temperature').first().click()

    await screen.getByRole('button', { name: 'Projection & basemap' }).click()
    await screen.getByRole('radio', { name: '3D globe' }).click()

    await expect.element(screen.getByTestId('globe-canvas')).toBeInTheDocument()
    await expect
      .poll(() => engineCalls.layers.at(-1)?.map((s) => s.params.LAYERS))
      .toEqual(['2t'])
    expect(engineCalls.layers.at(-1)?.[0].time).toBe('2026-07-06T00:00:00Z')
    // Map-click tools have no globe counterpart.
    await expect
      .element(screen.getByRole('button', { name: 'Measure distance' }))
      .toBeDisabled()

    const destroyed = engineCalls.destroyed
    await screen.getByRole('radio', { name: /^Web Mercator/ }).click()
    await expect.poll(() => engineCalls.destroyed).toBe(destroyed + 1)
    await expect
      .element(screen.getByTestId('globe-view'))
      .not.toBeInTheDocument()
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
