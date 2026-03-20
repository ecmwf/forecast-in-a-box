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
 * JobListPage Integration Tests
 *
 * Tests the executions list page with MSW-mocked API responses:
 * - Renders page header and filter controls
 * - Renders job list items with correct status and links
 * - Status filtering works correctly
 * - Search filters by jobId
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { resetJobsState } from '@tests/../mocks/data/job.data'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { JobListPage } from '@/features/executions/components/JobListPage'

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

function renderJobList() {
  return renderWithRouter(
    <AuthContext.Provider value={anonymousAuth}>
      <JobListPage />
    </AuthContext.Provider>,
  )
}

// Truncated IDs match jobId.slice(0, 12) from JobListItem
// job-completed-001 → #job-complete...
// job-running-002   → #job-running-...
// job-errored-003   → #job-errored-...
// job-submitted-004 → #job-submitte...

describe('JobListPage Integration', () => {
  beforeEach(() => {
    resetJobsState()
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
        .element(screen.getByPlaceholder('Search executions...'))
        .toBeVisible()
    })

    it('renders status filter buttons', async () => {
      const screen = await renderJobList()
      await expect
        .element(screen.getByRole('button', { name: 'All' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Running' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Completed' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Failed' }))
        .toBeVisible()
    })

    it('renders job items from the API', async () => {
      const screen = await renderJobList()

      // Truncated job IDs from job.data.ts (slice 0..12)
      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      await expect.element(screen.getByText('#job-errored-...')).toBeVisible()
      await expect.element(screen.getByText('#job-submitte...')).toBeVisible()
    })

    it('renders status labels for jobs', async () => {
      const screen = await renderJobList()

      // Status labels are combined with timestamps like "Completed · 3 days ago"
      // Use regex to match just the status text at the beginning
      await expect.element(screen.getByText(/^Completed ·/)).toBeVisible()
      await expect.element(screen.getByText(/^Running ·/)).toBeVisible()
      await expect.element(screen.getByText(/^Failed ·/)).toBeVisible()
      await expect.element(screen.getByText(/^Submitted ·/)).toBeVisible()
    })
  })

  describe('metadata display', () => {
    it('shows Untitled Job when fable lookup returns no data', async () => {
      const screen = await renderJobList()
      const untitled = screen.getByText('Untitled Job')
      await expect.element(untitled.first()).toBeVisible()
    })
  })

  describe('filtering', () => {
    it('filters to running jobs when Running button is clicked', async () => {
      const screen = await renderJobList()

      await screen.getByRole('button', { name: 'Running' }).click()

      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      expect(screen.getByText('#job-complete...').query()).toBeNull()
    })

    it('filters to completed jobs when Completed button is clicked', async () => {
      const screen = await renderJobList()

      await screen.getByRole('button', { name: 'Completed' }).click()

      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      expect(screen.getByText('#job-running-...').query()).toBeNull()
    })

    it('returns to all jobs when All is clicked after filtering', async () => {
      const screen = await renderJobList()

      await screen.getByRole('button', { name: 'Running' }).click()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()

      await screen.getByRole('button', { name: 'All' }).click()
      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
    })
  })

  describe('search', () => {
    it('filters jobs by job ID', async () => {
      const screen = await renderJobList()

      const searchInput = screen.getByPlaceholder('Search executions...')
      await searchInput.fill('completed')

      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      expect(screen.getByText('#job-running-...').query()).toBeNull()
    })
  })

  describe('navigation links', () => {
    it('renders View link for completed jobs', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('View')).toBeVisible()
    })

    it('renders Execution Failed link for errored jobs', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('Execution Failed')).toBeVisible()
    })

    it('renders Inspect link for submitted jobs', async () => {
      const screen = await renderJobList()
      await expect.element(screen.getByText('Inspect')).toBeVisible()
    })
  })
})
