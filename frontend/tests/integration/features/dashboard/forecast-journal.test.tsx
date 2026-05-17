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
 * ForecastJournal Integration Tests — the dashboard journal widget against the
 * /run/list API: rendering, status filtering, bookmarking, "View all".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import { resetJobsState } from '@tests/../mocks/data/job.data'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { ForecastJournal } from '@/features/dashboard/components/ForecastJournal'

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

function renderJournal() {
  return renderWithRouter(
    <AuthContext.Provider value={anonymousAuth}>
      <ForecastJournal />
    </AuthContext.Provider>,
  )
}

describe('ForecastJournal Integration', () => {
  beforeEach(() => {
    localStorage.clear()
    resetJobsState()
  })

  describe('rendering', () => {
    it('renders the journal title', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('Forecast Journal')).toBeVisible()
    })

    it('renders the search input', async () => {
      const screen = await renderJournal()
      await expect
        .element(
          screen.getByPlaceholder('Search or filter, e.g. tag:production'),
        )
        .toBeVisible()
    })

    it('renders the status filter buttons', async () => {
      const screen = await renderJournal()
      for (const name of ['All', 'Running', 'Completed', 'Failed']) {
        await expect
          .element(screen.getByRole('button', { name, exact: true }))
          .toBeVisible()
      }
    })

    it('renders runs from the API', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
    })

    it('shows a "View all" link to the executions page', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('View all')).toBeVisible()
    })
  })

  describe('run rows', () => {
    it('shows progress for the running run', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('45%')).toBeVisible()
    })

    it('links completed runs to their results', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('View Results')).toBeVisible()
    })

    it('links failed runs to their error', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('View Error')).toBeVisible()
    })
  })

  describe('filtering', () => {
    it('filters to running runs only', async () => {
      const screen = await renderJournal()
      await screen.getByRole('button', { name: 'Running', exact: true }).click()

      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      expect(screen.getByText('#job-complete...').query()).toBeNull()
    })

    it('filters to completed runs only', async () => {
      const screen = await renderJournal()
      await screen
        .getByRole('button', { name: 'Completed', exact: true })
        .click()

      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
      expect(screen.getByText('#job-running-...').query()).toBeNull()
    })

    it('shows the empty state when no runs are bookmarked', async () => {
      const screen = await renderJournal()
      await screen
        .getByRole('button', { name: 'Bookmarked', exact: true })
        .click()

      await expect
        .element(screen.getByText('No forecasts found matching your criteria.'))
        .toBeVisible()
    })
  })

  describe('bookmarking', () => {
    it('bookmarks a run so it appears under the Bookmarked filter', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()

      await screen.getByLabelText('Bookmark').first().click()
      await screen
        .getByRole('button', { name: 'Bookmarked', exact: true })
        .click()

      expect(
        screen.getByText('No forecasts found matching your criteria.').query(),
      ).toBeNull()
    })
  })
})
