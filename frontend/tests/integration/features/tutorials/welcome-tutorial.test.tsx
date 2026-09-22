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
 * Welcome tour integration — the runner carries the tour across pages via
 * per-step routes, pointing at the section nav, and a starter pick on the
 * final Overview step completes it.
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
import { NavToggle } from '@/components/layout/NavToggle'
import { GettingStartedSection } from '@/features/dashboard/components/GettingStartedSection'
import { TutorialsController } from '@/features/tutorials/TutorialsController'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useTutorialsStore } from '@/stores/tutorialsStore'
import i18n from '@/lib/i18n'

const PAGES = ['/configure', '/execute', '/visualise'] as const

async function renderAppShell() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  // The real nav plus the runner, as the authenticated layout mounts them.
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    component: () => (
      <>
        <NavToggle />
        <Outlet />
        <TutorialsController />
      </>
    ),
  })
  const overviewRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/overview',
    component: GettingStartedSection,
  })
  const pageRoutes = PAGES.map((path) =>
    createRoute({
      getParentRoute: () => authenticatedRoute,
      path,
      component: () => <h1>{path}</h1>,
    }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authenticatedRoute.addChildren([overviewRoute, ...pageRoutes]),
    ]),
    history: createMemoryHistory({ initialEntries: ['/overview'] }),
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { screen, router }
}

const card = () => document.querySelector('[data-tour-card]')

beforeEach(() => {
  // No Tailwind in browser mode — pin the shade so it can't cover the page.
  const style = document.createElement('style')
  style.textContent =
    '[data-slot="spotlight-shade"]{position:fixed;inset:0;pointer-events:none}'
  document.head.appendChild(style)
})

describe('welcome tour', () => {
  it('walks the section pages and completes on a starter pick', async () => {
    const { screen, router } = await renderAppShell()
    useTutorialsStore.getState().start('welcome-tour')

    await expect
      .element(
        screen.getByRole('heading', { name: 'Your dashboard, at a glance' }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('1 of 5', { exact: true }))
      .toBeVisible()
    // The spotlight sits on the Overview tab.
    expect(
      document.querySelector('[data-slot="spotlight-shade"]'),
    ).not.toBeNull()

    const titles: Array<[string, string]> = [
      ['/configure', 'Compose forecasts from blocks'],
      ['/execute', 'Run it, then inspect results in place'],
      ['/visualise', 'Visualise and compare on the map'],
      ['/overview', 'Run your first forecast'],
    ]
    for (const [i, [path, title]] of titles.entries()) {
      await screen
        .getByRole('button', { name: i === 0 ? 'Start' : 'Next', exact: true })
        .click()
      await expect
        .element(screen.getByRole('heading', { name: title }))
        .toBeVisible()
      expect(router.state.location.pathname).toBe(path)
    }
    // The final step points at the real starters and offers Done.
    await expect
      .element(screen.getByRole('button', { name: 'Done' }))
      .toBeVisible()

    await screen.getByRole('button', { name: 'Start from Scratch' }).click()

    await expect.poll(() => useTutorialsStore.getState().active).toBeNull()
    expect(router.state.location.pathname).toBe('/configure')
    expect(useTutorialsStore.getState().statuses['welcome-tour']).toBe(
      'completed',
    )
    // Finishing the tour counts as onboarded.
    expect(useOnboardingStore.getState().status).toBe('active')
  })

  it('Back returns to the previous page', async () => {
    const { screen, router } = await renderAppShell()
    useTutorialsStore.getState().start('welcome-tour')

    await screen.getByRole('button', { name: 'Start', exact: true }).click()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Compose forecasts from blocks' }),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Back' }).click()

    await expect
      .element(
        screen.getByRole('heading', { name: 'Your dashboard, at a glance' }),
      )
      .toBeVisible()
    expect(router.state.location.pathname).toBe('/overview')
  })

  it('leaving the step page by hand ends the tour', async () => {
    const { screen, router } = await renderAppShell()
    useTutorialsStore.getState().start('welcome-tour')

    await screen.getByRole('button', { name: 'Start', exact: true }).click()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Compose forecasts from blocks' }),
      )
      .toBeVisible()
    await screen.getByRole('link', { name: 'Visualise' }).click()

    await expect.poll(() => useTutorialsStore.getState().active).toBeNull()
    expect(router.state.location.pathname).toBe('/visualise')
    expect(card()).toBeNull()
    // An interrupted run keeps the card's snooze; nothing is recorded.
    expect(
      useTutorialsStore.getState().statuses['welcome-tour'],
    ).toBeUndefined()
    expect(useOnboardingStore.getState().status).toBe('not-started')
  })
})
