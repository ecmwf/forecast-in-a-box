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
 * NavToggle Integration Tests
 *
 * Tests the centered navigation toggle component:
 * - Renders a navigation landmark with three route links
 * - Highlights the active link with aria-current="page"
 * - Active state follows route changes
 */

import { describe, expect, it } from 'vitest'
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
import { NavToggle } from '@/components/layout/NavToggle'
import i18n from '@/lib/i18n'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Renders NavToggle with a router that knows about all three nav routes,
 * starting at the given path so active-link matching works.
 */
function renderNavToggle(initialPath: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })

  const routes = ['/dashboard', '/configure', '/executions'].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <NavToggle />,
    }),
  )

  const routeTree = rootRoute.addChildren(routes)
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('NavToggle', () => {
  it('renders a navigation landmark', async () => {
    const screen = await renderNavToggle('/dashboard')
    await expect
      .element(screen.getByRole('navigation', { name: 'Main navigation' }))
      .toBeVisible()
  })

  it('renders all three nav links', async () => {
    const screen = await renderNavToggle('/dashboard')
    await expect.element(screen.getByText('Overview')).toBeVisible()
    await expect.element(screen.getByText('Configuration')).toBeVisible()
    await expect.element(screen.getByText('Executions')).toBeVisible()
  })

  it('marks Overview as active on /dashboard', async () => {
    const screen = await renderNavToggle('/dashboard')
    const link = screen.getByText('Overview')
    await expect.element(link).toHaveAttribute('aria-current', 'page')
  })

  it('marks Configuration as active on /configure', async () => {
    const screen = await renderNavToggle('/configure')
    const link = screen.getByText('Configuration')
    await expect.element(link).toHaveAttribute('aria-current', 'page')
  })

  it('marks Executions as active on /executions', async () => {
    const screen = await renderNavToggle('/executions')
    const link = screen.getByText('Executions')
    await expect.element(link).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark inactive links with aria-current', async () => {
    const screen = await renderNavToggle('/dashboard')
    const configLink = screen.getByText('Configuration')
    const execLink = screen.getByText('Executions')
    await expect.element(configLink).not.toHaveAttribute('aria-current')
    await expect.element(execLink).not.toHaveAttribute('aria-current')
  })
})
