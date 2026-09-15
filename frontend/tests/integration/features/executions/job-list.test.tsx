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
import {
  injectMockExecution,
  resetJobsState,
  secondGribRunExecution,
} from '@tests/../mocks/data/job.data'
import { resetLensState } from '@tests/../mocks/data/lens.data'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { RUN_WINDOW } from '@/api/hooks/useJobStatusCounts'
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

/** Enough completed runs to spill past the first page of ten. */
function seedCompletedRuns(count: number) {
  for (let i = 0; i < count; i++) {
    const createdAt = new Date(Date.now() - (i + 1) * 60_000).toISOString()
    injectMockExecution({
      ...secondGribRunExecution,
      run_id: `job-completed-extra-${String(i + 1).padStart(2, '0')}`,
      created_at: createdAt,
      updated_at: createdAt,
    })
  }
}

describe('RunListPage Integration', () => {
  beforeEach(() => {
    localStorage.clear()
    resetJobsState()
    resetLensState()
    // No Tailwind in browser mode: the Base UI checkbox is an empty span with
    // no box, which Playwright treats as invisible. Give it one.
    if (!document.querySelector('[data-test-shim="checkbox"]')) {
      const style = document.createElement('style')
      style.setAttribute('data-test-shim', 'checkbox')
      style.textContent =
        '[data-slot="checkbox"]{display:inline-block;width:16px;height:16px}'
      document.head.appendChild(style)
    }
  })

  describe('rendering', () => {
    it('renders the page header', async () => {
      const screen = await renderJobList()
      await expect
        .element(screen.getByRole('heading', { level: 1, name: 'Runs' }))
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
      await expect
        .element(screen.getByTestId('run-row-job-completed-001'))
        .toBeVisible()
      await expect
        .element(screen.getByTestId('run-row-job-running-002'))
        .toBeVisible()
      await expect
        .element(screen.getByTestId('run-row-job-errored-003'))
        .toBeVisible()
      await expect
        .element(screen.getByTestId('run-row-job-submitted-004'))
        .toBeVisible()
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

      await expect
        .element(screen.getByTestId('run-row-job-running-002'))
        .toBeVisible()
      expect(screen.getByTestId('run-row-job-completed-001').query()).toBeNull()
    })

    it('filters to completed runs', async () => {
      const screen = await renderJobList()
      await screen
        .getByRole('button', { name: 'Completed', exact: true })
        .click()

      await expect
        .element(screen.getByTestId('run-row-job-completed-001'))
        .toBeVisible()
      expect(screen.getByTestId('run-row-job-running-002').query()).toBeNull()
    })

    it('returns to all runs when All is clicked', async () => {
      const screen = await renderJobList()
      await screen.getByRole('button', { name: 'Running', exact: true }).click()
      await expect
        .element(screen.getByTestId('run-row-job-running-002'))
        .toBeVisible()

      await screen.getByRole('button', { name: 'All', exact: true }).click()
      await expect
        .element(screen.getByTestId('run-row-job-completed-001'))
        .toBeVisible()
      await expect
        .element(screen.getByTestId('run-row-job-running-002'))
        .toBeVisible()
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

      await expect
        .element(screen.getByTestId('run-row-job-completed-001'))
        .toBeVisible()
      expect(screen.getByTestId('run-row-job-running-002').query()).toBeNull()
    })
  })

  describe('across pages', () => {
    it('says so when the run window leaves older runs out', async () => {
      seedCompletedRuns(RUN_WINDOW)
      const screen = await renderJobList()
      await expect
        .element(screen.getByText(/^Showing the 300 most recent of \d+ runs\./))
        .toBeVisible()
    })

    it('a status filter spans the whole list, not the current page', async () => {
      seedCompletedRuns(12)
      const screen = await renderJobList()
      await screen
        .getByRole('button', { name: 'Completed', exact: true })
        .click()

      await expect.element(screen.getByText('Page 1 of 2')).toBeVisible()
      expect(screen.getByTestId('run-row-job-running-002').query()).toBeNull()

      await screen.getByRole('button', { name: 'Next', exact: true }).click()
      await expect.element(screen.getByText('Page 2 of 2')).toBeVisible()
      expect(screen.getByTestId('run-row-job-running-002').query()).toBeNull()
    })

    it('runs ticked on different pages stay selected for comparison', async () => {
      seedCompletedRuns(12)
      const screen = await renderJobList()
      await screen
        .getByRole('button', { name: 'Completed', exact: true })
        .click()
      await expect.element(screen.getByText('Page 1 of 2')).toBeVisible()

      // Seed order: the fixtures first, then the extras — 01 lands on page 1, 12 on page 2.
      const row1 = screen.getByTestId('run-row-job-completed-extra-01')
      await expect.element(row1).toBeVisible()
      // Long unstyled page: bring the row into the test viewport first.
      row1.element().scrollIntoView({ block: 'center' })
      await row1.getByRole('checkbox').click()
      await screen.getByRole('button', { name: 'Next', exact: true }).click()
      await expect.element(screen.getByText('Page 2 of 2')).toBeVisible()
      const row12 = screen.getByTestId('run-row-job-completed-extra-12')
      await expect.element(row12).toBeVisible()
      row12.element().scrollIntoView({ block: 'center' })
      await row12.getByRole('checkbox').click()

      await expect.element(screen.getByText('2 runs selected')).toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Compare selected' }))
        .toBeEnabled()
    })
  })
})
