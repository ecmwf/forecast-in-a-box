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
 * External-WMS form in the source picker: a URL is probed (GetCapabilities
 * fetched + parsed) before it becomes a `wms:` basket entry; failures give
 * actionable, distinguishable errors.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { resetJobsState } from '@tests/../mocks/data/job.data'
import { resetLensState } from '@tests/../mocks/data/lens.data'
import { registerMockWmsServer } from '@tests/../mocks/data/wms.data'
import { SourcePicker } from '@/features/visualise/components/SourcePicker'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'
import i18n from '@/lib/i18n'

let nextPort = 19900

async function renderPicker() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // The picker reads the /visualise URL pair (lens in-use guard), so it
  // must render inside that route.
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    component: () => <Outlet />,
  })
  const visualiseRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/visualise',
    component: SourcePicker,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authenticatedRoute.addChildren([visualiseRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ['/visualise'] }),
  })
  return await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetJobsState()
  resetLensState()
})

describe('External WMS form', () => {
  it('probes a reachable WMS endpoint and adds it to the basket', async () => {
    const port = nextPort++
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    const screen = await renderPicker()

    await screen
      .getByPlaceholder('https://maps.example.org/wms')
      .fill(`http://localhost:${port}/wms?token=public`)
    await screen.getByRole('button', { name: 'Connect & add' }).click()

    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
    expect(useComparisonStore.getState().entries[0]).toMatchObject({
      kind: 'wms',
      // Kept VERBATIM — path and query (tokens!) are part of the endpoint.
      url: `http://localhost:${port}/wms?token=public`,
      label: `localhost:${port}`,
    })
  })

  it('accepts a bare origin by probing the /wms lens convention', async () => {
    const port = nextPort++
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
    })
    const screen = await renderPicker()

    await screen
      .getByPlaceholder('https://maps.example.org/wms')
      .fill(`http://localhost:${port}`)
    await screen.getByRole('button', { name: 'Connect & add' }).click()

    await expect
      .poll(() => useComparisonStore.getState().entries)
      .toHaveLength(1)
  })

  it('rejects unparsable input without touching the basket', async () => {
    const screen = await renderPicker()
    await screen
      .getByPlaceholder('https://maps.example.org/wms')
      .fill('not a url')
    await screen.getByRole('button', { name: 'Connect & add' }).click()

    await expect
      .element(screen.getByText('Enter a valid http(s) URL'))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
  })

  it('reports an HTTP error status for reachable-but-rejecting servers', async () => {
    const port = nextPort++ // never registered → 503
    const screen = await renderPicker()
    await screen
      .getByPlaceholder('https://maps.example.org/wms')
      .fill(`http://localhost:${port}`)
    await screen.getByRole('button', { name: 'Connect & add' }).click()

    await expect
      .element(screen.getByText(/responded with HTTP 503/))
      .toBeVisible()
    expect(useComparisonStore.getState().entries).toHaveLength(0)
  })
})
