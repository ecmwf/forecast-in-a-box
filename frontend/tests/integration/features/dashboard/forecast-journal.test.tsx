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
 * ForecastJournal Integration Tests
 *
 * Tests the ForecastJournal component with real child components
 * (ForecastJournalItem, ForecastJournalFilters) rendered together:
 * - Renders journal section with title, search, and filters
 * - Renders journal items with correct information
 * - Shows empty state when no items match
 * - Filters work correctly (running, completed, error, bookmarked)
 * - Search and filter can be combined
 */

import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { ForecastJournal } from '@/features/dashboard'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

/**
 * Anonymous auth context for wrapping dashboard components
 */
const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

describe('ForecastJournal Integration', () => {
  describe('rendering', () => {
    it('renders the journal title', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Forecast Journal')).toBeVisible()
    })

    it('renders the search input', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByPlaceholder('Search or add filters...'))
        .toBeVisible()
    })

    it('renders filter buttons', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

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
        .element(screen.getByRole('button', { name: 'Error' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'Bookmarked' }))
        .toBeVisible()
    })

    it('renders load more button when jobs exist', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Load more history')).toBeVisible()
    })
  })

  describe('journal items', () => {
    it('renders all mock job names', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByText('Europe Weather - 72h'))
        .toBeVisible()
      await expect
        .element(screen.getByText('North America - 120h'))
        .toBeVisible()
      await expect.element(screen.getByText('Asia Pacific - 48h')).toBeVisible()
      await expect
        .element(screen.getByText('Global Forecast - 240h'))
        .toBeVisible()
      await expect
        .element(screen.getByText('Mediterranean Sea - 96h'))
        .toBeVisible()
      await expect
        .element(screen.getByText('Arctic Region - 168h'))
        .toBeVisible()
    })

    it('renders job IDs', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('#a3f7c2d')).toBeVisible()
      await expect.element(screen.getByText('#8k9m2p1')).toBeVisible()
    })

    it('renders model information', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByText(/Model: AIFS Global/).first())
        .toBeVisible()
      await expect.element(screen.getByText(/Model: IFS ENS/)).toBeVisible()
    })

    it('renders tags on journal items', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByText('high-priority').first())
        .toBeVisible()
      await expect.element(screen.getByText('wind-analysis')).toBeVisible()
      await expect.element(screen.getByText('production')).toBeVisible()
      await expect.element(screen.getByText('marine')).toBeVisible()
    })

    it('shows progress percentage for running jobs', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('65%')).toBeVisible()
      await expect.element(screen.getByText('23%')).toBeVisible()
    })

    it('shows View Results link for completed jobs', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const viewResultsLinks = screen.getByText('View Results')
      await expect.element(viewResultsLinks.first()).toBeVisible()
    })

    it('shows View Error link for error jobs', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('View Error')).toBeVisible()
    })

    it('shows scheduled badge for scheduled jobs', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const scheduledBadges = screen.getByText('Scheduled')
      await expect.element(scheduledBadges.first()).toBeVisible()
    })

    it('renders bookmark buttons on each item', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const bookmarkButtons = screen.getByLabelText('Bookmark')
      await expect.element(bookmarkButtons.first()).toBeInTheDocument()
    })
  })

  describe('filtering', () => {
    it('filters to running jobs only', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await screen.getByText('Running').click()

      // Running jobs should be visible
      await expect
        .element(screen.getByText('Europe Weather - 72h'))
        .toBeVisible()
      await expect
        .element(screen.getByText('Arctic Region - 168h'))
        .toBeVisible()

      // Completed and error jobs should not be present
      expect(screen.getByText('North America - 120h').query()).toBeNull()
      expect(screen.getByText('Global Forecast - 240h').query()).toBeNull()
    })

    it('filters to completed jobs only', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await screen.getByText('Completed').click()

      // Completed jobs should be visible
      await expect
        .element(screen.getByText('North America - 120h'))
        .toBeVisible()
      await expect.element(screen.getByText('Asia Pacific - 48h')).toBeVisible()
      await expect
        .element(screen.getByText('Mediterranean Sea - 96h'))
        .toBeVisible()

      // Running jobs should not be present
      expect(screen.getByText('Europe Weather - 72h').query()).toBeNull()
    })

    it('filters to error jobs only', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      await screen.getByRole('button', { name: 'Error' }).click()

      // Error job should be visible
      await expect
        .element(screen.getByText('Global Forecast - 240h'))
        .toBeVisible()

      // Other jobs should not be present
      expect(screen.getByText('Europe Weather - 72h').query()).toBeNull()
      expect(screen.getByText('North America - 120h').query()).toBeNull()
    })

    it('shows empty state when bookmarked filter has no results', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      // All mock jobs have isBookmarked: false
      await screen.getByText('Bookmarked').click()

      await expect
        .element(screen.getByText('No forecasts found matching your criteria.'))
        .toBeVisible()

      // Load more button should not be visible
      expect(screen.getByText('Load more history').query()).toBeNull()
    })

    it('returns to all jobs when All filter is clicked after filtering', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      // First filter to error
      await screen.getByRole('button', { name: 'Error' }).click()
      await expect
        .element(screen.getByText('Global Forecast - 240h'))
        .toBeVisible()

      // Then click All
      await screen.getByText('All').click()

      // All jobs should be visible again
      await expect
        .element(screen.getByText('Europe Weather - 72h'))
        .toBeVisible()
      await expect
        .element(screen.getByText('North America - 120h'))
        .toBeVisible()
      await expect
        .element(screen.getByText('Global Forecast - 240h'))
        .toBeVisible()
    })
  })

  describe('searching', () => {
    it('filters jobs by name search', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const searchInput = screen.getByPlaceholder('Search or add filters...')
      await searchInput.fill('Europe')

      await expect
        .element(screen.getByText('Europe Weather - 72h'))
        .toBeVisible()

      expect(screen.getByText('North America - 120h').query()).toBeNull()
    })

    it('filters jobs by model search', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const searchInput = screen.getByPlaceholder('Search or add filters...')
      await searchInput.fill('IFS ENS')

      await expect
        .element(screen.getByText('North America - 120h'))
        .toBeVisible()

      expect(screen.getByText('Europe Weather - 72h').query()).toBeNull()
    })

    it('filters jobs by tag search', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const searchInput = screen.getByPlaceholder('Search or add filters...')
      await searchInput.fill('marine')

      await expect
        .element(screen.getByText('Mediterranean Sea - 96h'))
        .toBeVisible()

      expect(screen.getByText('Europe Weather - 72h').query()).toBeNull()
    })

    it('shows empty state when search has no results', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const searchInput = screen.getByPlaceholder('Search or add filters...')
      await searchInput.fill('nonexistent-query')

      await expect
        .element(screen.getByText('No forecasts found matching your criteria.'))
        .toBeVisible()
    })

    it('search is case insensitive', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      const searchInput = screen.getByPlaceholder('Search or add filters...')
      await searchInput.fill('EUROPE')

      await expect
        .element(screen.getByText('Europe Weather - 72h'))
        .toBeVisible()
    })
  })

  describe('combined filtering and searching', () => {
    it('applies both filter and search together', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <ForecastJournal />
        </AuthContext.Provider>,
      )

      // Filter to completed
      await screen.getByText('Completed').click()

      // Then search for "Asia"
      const searchInput = screen.getByPlaceholder('Search or add filters...')
      await searchInput.fill('Asia')

      // Should only see completed Asia job
      await expect.element(screen.getByText('Asia Pacific - 48h')).toBeVisible()

      // Other completed jobs should not be present
      expect(screen.getByText('North America - 120h').query()).toBeNull()
      expect(screen.getByText('Mediterranean Sea - 96h').query()).toBeNull()
    })
  })
})
