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
 * Test Rendering Utilities
 *
 * Provides custom render function that wraps components with necessary providers
 * for testing (QueryClient, I18n, Router, etc.)
 */

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
import type { ReactNode } from 'react'
import i18n from '@/lib/i18n'

/**
 * Creates a fresh QueryClient for each test
 * Disables retries to make tests faster and more predictable
 */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface RenderWithProvidersOptions {
  queryClient?: QueryClient
}

/**
 * Renders a component wrapped with all necessary providers for testing
 *
 * @example
 * ```tsx
 * const { getByText } = renderWithProviders(<MyComponent />)
 * await expect.element(getByText('Hello')).toBeVisible()
 * ```
 */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderWithProvidersOptions = {},
) {
  const { queryClient = createTestQueryClient() } = options

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  )
}

/**
 * Minimal root route for testing - just renders children via Outlet
 * This avoids dependencies from the real root route (useConfig, etc.)
 */
const testRootRoute = createRootRoute({
  component: () => <Outlet />,
})

interface RenderWithRouterOptions {
  queryClient?: QueryClient
  initialEntries?: Array<string>
}

/**
 * Renders a component wrapped with Router + Query + I18n providers
 *
 * Uses a minimal router setup to avoid dependencies from the real route tree.
 * Use this for components that use TanStack Router features like <Link>.
 *
 * @example
 * ```tsx
 * const { getByText } = renderWithRouter(<FableBuilderPage />)
 * await expect.element(getByText('Block Palette')).toBeVisible()
 * ```
 */
export function renderWithRouter(
  ui: ReactNode,
  options: RenderWithRouterOptions = {},
) {
  const { queryClient = createTestQueryClient(), initialEntries = ['/'] } =
    options

  const memoryHistory = createMemoryHistory({ initialEntries })

  // Create a wrapper route that renders the test component
  const wrapperRoute = createRoute({
    getParentRoute: () => testRootRoute,
    path: '/',
    component: () => <>{ui}</>,
  })

  const routeTree = testRootRoute.addChildren([wrapperRoute])

  const router = createRouter({
    routeTree,
    history: memoryHistory,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

// Re-export everything from vitest-browser-react for convenience
export * from 'vitest-browser-react'
