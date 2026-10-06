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
 * GeoViewer harness for the globe tests. Import it after mocking
 * `engine-entry` and `webgl-support` with `globe-engine-mock`.
 */

import { Profiler, useState } from 'react'
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
import { engineCalls } from './globe-engine-mock'
import type { CompareMode } from '@/features/viewer/geo/types'
import type { ViewerUrlState } from '@/features/viewer/geo/view-url-state'
import { GeoViewer } from '@/features/viewer/geo/GeoViewer'
import i18n from '@/lib/i18n'

let nextPort = 19950

export function Harness({
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

export function registerServer(crs?: Array<string>): number {
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
export function injectMapSizing(): () => void {
  const style = document.createElement('style')
  style.textContent = `
      [class*='h-full'][class*='overflow-hidden'][class*='rounded-md'] { position: relative; height: 400px; }
      [class*='absolute'][class*='inset-0'] { position: absolute; inset: 0; }
      [data-globe-panel] { position: relative; height: 400px; }
      [class*='absolute'][class*='top-2'][class*='right-2'] { position: absolute; top: 8px; right: 8px; z-index: 10; }
      [class~='pointer-events-none'] { pointer-events: none; }
      [class~='sr-only'] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    `
  document.head.append(style)
  return () => style.remove()
}
