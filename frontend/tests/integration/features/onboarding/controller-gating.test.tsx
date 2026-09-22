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
 * OnboardingController gating against live MSW queries — existing users,
 * fresh-user open, and the only-on-/overview rule.
 */

import { HttpResponse, http } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'
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
import { worker } from '@tests/test-extend'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { OnboardingController } from '@/features/onboarding/OnboardingController'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { API_ENDPOINTS } from '@/api/endpoints'
import i18n from '@/lib/i18n'

const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

const emptyJobList = http.get(API_ENDPOINTS.job.list, () =>
  HttpResponse.json({
    runs: [],
    total: 0,
    page: 1,
    page_size: 100,
    total_pages: 1,
  }),
)

/** Mirrors the real _authenticated layout: controller beside the outlet. */
function renderAt(pathname: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const rootRoute = createRootRoute({
    component: () => (
      <AuthContext.Provider value={anonymousAuth}>
        <Outlet />
        <OnboardingController />
      </AuthContext.Provider>
    ),
  })
  const overviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/overview',
    component: () => <div>overview page</div>,
  })
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/other',
    component: () => <div>other page</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([overviewRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('OnboardingController gating', () => {
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="dialog-content"]{position:fixed;top:0;left:0;z-index:50;max-height:100vh;overflow:auto}'
    document.head.appendChild(style)
  })

  it('silently skips a browser that already has runs', async () => {
    // Default MSW seed ships completed runs — the "existing user" case.
    const screen = await renderAt('/overview')

    // Lazy gate + jobs query: a cold CI runner exceeds the 1000ms default.
    await expect
      .poll(() => useOnboardingStore.getState().status, { timeout: 8000 })
      .toBe('skipped')
    expect(screen.getByText(/Welcome to Forecast-in-a-Box/).query()).toBeNull()
  })

  it('opens for a fresh user once queries settle', async () => {
    worker.use(emptyJobList)
    const screen = await renderAt('/overview')

    await expect
      .element(screen.getByText(/Welcome to Forecast-in-a-Box/), {
        timeout: 8000,
      })
      .toBeVisible()
    expect(useOnboardingStore.getState().status).toBe('not-started')
  })

  it('never auto-opens off /overview', async () => {
    worker.use(emptyJobList)
    const screen = await renderAt('/other')

    await expect
      .element(screen.getByText('other page'), { timeout: 8000 })
      .toBeVisible()
    // Give the queries a beat to settle; the gate must still decline.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.getByText(/Welcome to Forecast-in-a-Box/).query()).toBeNull()
    expect(useOnboardingStore.getState().status).toBe('not-started')
  })
})
