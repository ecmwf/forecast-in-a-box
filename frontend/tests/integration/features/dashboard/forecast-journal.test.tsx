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
 * /run/list API: rendering, bookmarking, the hand-off to the runs page.
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
    it('renders the recent-runs title', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('Recent runs')).toBeVisible()
    })

    it('renders runs from the API', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      await expect.element(screen.getByText('#job-complete...')).toBeVisible()
    })

    it('hands off to the runs page', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('View all runs')).toBeVisible()
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

  describe('bookmarking', () => {
    it('toggles a bookmark from the row', async () => {
      const screen = await renderJournal()
      await expect.element(screen.getByText('#job-running-...')).toBeVisible()
      await screen.getByLabelText('Bookmark').first().click()
      await expect
        .element(screen.getByLabelText('Remove bookmark').first())
        .toBeVisible()
    })
  })
})
