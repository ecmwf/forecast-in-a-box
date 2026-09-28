/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SourcePicker } from '@/features/visualise/components/SourcePicker'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'
import i18n from '@/lib/i18n'

/** The picker reads the A/B slot refs from the /visualise route. */
async function renderPicker() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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

describe('SourcePicker', () => {
  beforeEach(() => {
    useComparisonStore.setState({ entries: [] })
  })

  it('opens on the runs tab and switches the catalogue per tab', async () => {
    const screen = await renderPicker()
    await expect
      .element(screen.getByPlaceholder('Search runs and blocks…'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Known WMS servers'))
      .not.toBeInTheDocument()

    await screen.getByRole('tab', { name: 'WMS servers' }).click()
    await expect.element(screen.getByText('Known WMS servers')).toBeVisible()
    await expect
      .element(screen.getByLabelText('External WMS server'))
      .toBeVisible()

    await screen.getByRole('tab', { name: 'Host folder' }).click()
    await expect
      .element(screen.getByLabelText('GRIB directory on this host'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Known WMS servers'))
      .not.toBeInTheDocument()
  })

  it('shows the collection with its count and an empty hint', async () => {
    const screen = await renderPicker()
    await expect.element(screen.getByText('0 of 8')).toBeVisible()
    await expect.element(screen.getByText(/Nothing added yet/)).toBeVisible()

    useComparisonStore.getState().addEntry({
      kind: 'wms',
      url: 'https://maps.dwd.de/geoserver/ows?',
      label: 'DWD',
    })
    await expect.element(screen.getByText('1 of 8')).toBeVisible()
    await expect
      .element(screen.getByText(/Nothing added yet/))
      .not.toBeInTheDocument()
  })
})
