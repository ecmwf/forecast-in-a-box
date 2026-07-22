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
 * RunListPage Integration Tests — the /executions page against the /run/list
 * API: rendering, status filtering, search, per-run status links.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
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
import { z } from 'zod'
import { resetJobsState } from '@tests/../mocks/data/job.data'
import { resetLensState } from '@tests/../mocks/data/lens.data'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { RunListPage } from '@/features/executions/components/RunListPage'
import i18n from '@/lib/i18n'

vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

// Mirrors the real /executions search schema so validateSearch matches what RunListPage reads.
const searchSchema = z.object({
  q: z.string().optional(),
  status: z
    .enum(['all', 'submitted', 'running', 'completed', 'failed', 'bookmarked'])
    .optional(),
  group: z.enum(['none', 'date', 'schedule', 'tag']).optional(),
})

function renderJobList() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })

  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    component: () => <Outlet />,
  })
  const executionsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/execute',
    component: () => <Outlet />,
  })
  // Index route id `/_authenticated/execute/` — matches RunListPage's getRouteApi call.
  const listRoute = createRoute({
    getParentRoute: () => executionsRoute,
    path: '/',
    validateSearch: searchSchema,
    component: () => (
      <AuthContext.Provider value={anonymousAuth}>
        <RunListPage />
      </AuthContext.Provider>
    ),
  })

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([executionsRoute.addChildren([listRoute])]),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/execute'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

// Run-id chips truncate to runId.slice(0, 12) + "...", e.g. job-completed-001 → #job-complete...

describe('RunListPage Integration', () => {
  beforeEach(() => {
    localStorage.clear()
    resetJobsState()
    resetLensState()
  })

  describe('rendering', () => {
    it('renders the page header', async () => {
      const screen = await renderJobList()
      await expect
        .element(screen.getByRole('heading', { level: 1, name: 'Executions' }))
        .toBeVisible()
    })

    it('renders the search input', async () => {
      const screen = await renderJobList()
      await expect
        .element(
          screen.getByPlaceholder('Search or filter, e.g. tag:production'),
        )
        .toBeVisible()
    })

    it('renders the status filter buttons', async () => {
      const screen = await renderJobList()
      for (const name of ['Submitted', 'Running', 'Completed', 'Failed']) {
        await expect
          .element(screen.getByRole('button', { name, exact: true }))
          .toBeVisible()
      }
    })

    it('renders runs from the API', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      await expect.element(screen.getByText('#job-errored-...')).toBeVisible()
      await expect.element(screen.getByText('#job-submitte...')).toBeVisible()
    })

    it('falls back to "Untitled forecast" when the blueprint is unavailable', async () => {
      const screen = await renderJobList()
      await expect
        .element(screen.getByText('Untitled forecast').first())
        .toBeVisible()
    })
  })

  describe('status links', () => {
    it('links completed runs to their results', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('View Results')).toBeVisible()
    })

    it('links failed runs to their error', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('View Error')).toBeVisible()
    })

    it('links submitted runs to inspect', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('Inspect')).toBeVisible()
    })
  })

  describe('filtering', () => {
    it('filters to running runs', async () => {
      const screen = await renderJobList()
      await screen.getByRole('button', { name: 'Running', exact: true }).click()

      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      expect(screen.getByText('#job-complete...').query()).toBeNull()
    })

    it('filters to completed runs', async () => {
      const screen = await renderJobList()
      await screen
        .getByRole('button', { name: 'Completed', exact: true })
        .click()

      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      expect(screen.getByText('#job-running-...').query()).toBeNull()
    })

    it('returns to all runs when All is clicked', async () => {
      const screen = await renderJobList()
      await screen.getByRole('button', { name: 'Running', exact: true }).click()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()

      await screen.getByRole('button', { name: 'All', exact: true }).click()
      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
    })
  })

  describe('search', () => {
    it('filters runs by run id', async () => {
      const screen = await renderJobList()
      const search = screen.getByPlaceholder(
        'Search or filter, e.g. tag:production',
      )
      await search.fill('completed')
      await userEvent.keyboard('{Enter}')

      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      expect(screen.getByText('#job-running-...').query()).toBeNull()
    })
  })
})
