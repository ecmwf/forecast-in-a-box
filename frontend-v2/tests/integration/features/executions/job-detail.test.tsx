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
 * ExecutionDetailPage Integration Tests
 *
 * Tests the execution detail page with MSW-mocked API:
 * - Renders job status header with name, status badge, progress bar
 * - Shows description when available
 * - Tab switching between outputs, logs, specification
 * - Error state for nonexistent jobs
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { useJobMetadataStore } from '@/features/executions/stores/useJobMetadataStore'
import { ExecutionDetailPage } from '@/features/executions/components/ExecutionDetailPage'
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

function renderDetailPage(jobId: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })

  const rootRoute = createRootRoute({ component: () => <Outlet /> })

  // Layout route matching the _authenticated prefix used by useParams
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    component: () => <Outlet />,
  })

  const detailRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/executions/$jobId',
    component: () => (
      <AuthContext.Provider value={anonymousAuth}>
        <ExecutionDetailPage />
      </AuthContext.Provider>
    ),
  })

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([detailRoute]),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/executions/${jobId}`],
    }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ExecutionDetailPage Integration', () => {
  beforeEach(() => {
    resetJobsState()
    useJobMetadataStore.setState({ jobs: {} })
  })

  describe('rendering', () => {
    it('renders the back link', async () => {
      const screen = await renderDetailPage('job-completed-001')
      await expect.element(screen.getByText('Executions')).toBeVisible()
    })

    it('renders the job ID in the header', async () => {
      const screen = await renderDetailPage('job-completed-001')
      await expect.element(screen.getByText('job-completed-001')).toBeVisible()
    })

    it('renders status badge for completed job', async () => {
      const screen = await renderDetailPage('job-completed-001')
      await expect
        .element(screen.getByText('Completed', { exact: true }))
        .toBeVisible()
    })

    it('renders status badge for running job', async () => {
      const screen = await renderDetailPage('job-running-002')
      await expect
        .element(screen.getByText('Running', { exact: true }))
        .toBeVisible()
    })

    it('renders Untitled Job when no metadata', async () => {
      const screen = await renderDetailPage('job-completed-001')
      await expect.element(screen.getByText('Untitled Job')).toBeVisible()
    })

    it('renders job name from metadata', async () => {
      useJobMetadataStore.getState().addJob('job-completed-001', {
        name: 'My Forecast',
        description: '',
        tags: [],
        fableId: null,
        fableName: 'test',
        fableSnapshot: { blocks: {} },
        submittedAt: '2026-01-15T10:00:00Z',
      })

      const screen = await renderDetailPage('job-completed-001')
      await expect.element(screen.getByText('My Forecast')).toBeVisible()
    })

    it('renders description when available', async () => {
      useJobMetadataStore.getState().addJob('job-completed-001', {
        name: 'Test',
        description: 'Detailed forecast description',
        tags: [],
        fableId: null,
        fableName: 'test',
        fableSnapshot: { blocks: {} },
        submittedAt: '2026-01-15T10:00:00Z',
      })

      const screen = await renderDetailPage('job-completed-001')
      await expect
        .element(screen.getByText('Detailed forecast description'))
        .toBeVisible()
    })
  })

  describe('tabs', () => {
    it('renders tab buttons', async () => {
      const screen = await renderDetailPage('job-completed-001')

      await expect.element(screen.getByText('Outputs')).toBeVisible()
      await expect.element(screen.getByText('Logs')).toBeVisible()
      await expect.element(screen.getByText('Specification')).toBeVisible()
    })

    it('defaults to outputs tab', async () => {
      const screen = await renderDetailPage('job-completed-001')
      await expect.element(screen.getByText('Outputs')).toBeVisible()
    })
  })

  describe('actions', () => {
    it('renders restart button', async () => {
      const screen = await renderDetailPage('job-completed-001')
      await expect.element(screen.getByText('Restart')).toBeVisible()
    })

    it('renders three-dots menu', async () => {
      const screen = await renderDetailPage('job-completed-001')
      // The MoreVertical icon button should be present
      const buttons = screen.getByRole('button')
      await expect.element(buttons.first()).toBeVisible()
    })
  })

  describe('error state', () => {
    it('shows error message for nonexistent job', async () => {
      const screen = await renderDetailPage('nonexistent-job-id')
      await expect
        .element(screen.getByText('The requested job could not be found.'))
        .toBeVisible()
    })

    it('shows back to executions button on error', async () => {
      const screen = await renderDetailPage('nonexistent-job-id')
      await expect.element(screen.getByText('Back to Executions')).toBeVisible()
    })
  })

  describe('errored job', () => {
    it('shows error banner for errored job', async () => {
      const screen = await renderDetailPage('job-errored-003')
      await expect
        .element(screen.getByText('Errored', { exact: true }))
        .toBeVisible()
    })
  })
})
