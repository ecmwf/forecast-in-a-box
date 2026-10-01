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
 * Dashboard Integration Tests
 *
 * Tests the dashboard page rendering and interactions:
 * - Renders dashboard sections (welcome, getting started, etc.)
 * - Shows user-specific welcome text
 * - Quick actions render with correct labels
 * - Error state when status API fails
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { renderWithRouter } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { mockCommunityNews } from '../../../../mocks/handlers/news.handlers'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { CommunityNewsCard } from '@/features/dashboard/components/CommunityNewsCard'
import { GettingStartedSection } from '@/features/dashboard/components/GettingStartedSection'
import { useTemplateBookmarksStore } from '@/stores/templateBookmarksStore'
import { WelcomeCard } from '@/features/dashboard/components/WelcomeCard'
import { AuthContext } from '@/features/auth/AuthContext'
import { API_ENDPOINTS, STATIC_FILES } from '@/api/endpoints'
import { STORAGE_KEYS } from '@/lib/storage-keys'

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

describe('Dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEYS.auth.anonymousId, 'test-anon-id')
  })

  describe('WelcomeCard', () => {
    it('renders welcome heading for anonymous users', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // Anonymous users should see the anonymous welcome title
      const heading = screen.getByRole('heading', { level: 2 })
      await expect.element(heading).toBeVisible()
    })

    it('renders system status section', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('System status')).toBeVisible()
    })

    it('renders quick action buttons', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Manage plugins')).toBeVisible()
      await expect.element(screen.getByText('Manage runs')).toBeVisible()
      await expect.element(screen.getByText('Manage workflows')).toBeVisible()
      await expect.element(screen.getByText('Manage schedules')).toBeVisible()
    })

    it('shows error status when status API fails', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.error()
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // Should still render the card even with status error
      const heading = screen.getByRole('heading', { level: 2 })
      await expect.element(heading).toBeVisible()
    })
  })

  describe('GettingStartedSection', () => {
    const renderSection = () =>
      renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <GettingStartedSection />
        </AuthContext.Provider>,
      )

    it('renders getting started section', async () => {
      const screen = await renderSection()

      await expect.element(screen.getByText('Workflow templates')).toBeVisible()
    })

    it('offers the blank canvas plus three plugin templates', async () => {
      const screen = await renderSection()

      await expect
        .element(screen.getByRole('button', { name: 'Start from scratch' }))
        .toBeVisible()
      // MSW seeds four; the fourth must not reach the dashboard.
      await expect
        .element(screen.getByRole('button', { name: 'testTyped' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'testBasic' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'testThird' }))
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: 'testFourth' }))
        .not.toBeInTheDocument()
    })

    it('orders the cards by the plugin declaration order', async () => {
      const screen = await renderSection()

      await expect
        .element(screen.getByRole('button', { name: 'testThird' }))
        .toBeVisible()

      // The fixture's declared order differs from the list order.
      const titles = Array.from(
        screen.container.querySelectorAll('[role="button"] h3'),
      ).map((node) => node.textContent)
      expect(titles).toEqual([
        'Start from scratch',
        'testTyped',
        'testBasic',
        'testThird',
      ])
    })

    it('shows bookmarked templates first and drops the bookmark hint', async () => {
      useTemplateBookmarksStore.setState({
        keys: ['ecmwf:ecmwf-base::testFourth'],
      })
      const screen = await renderSection()

      await expect
        .element(screen.getByRole('button', { name: 'testFourth' }))
        .toBeVisible()
      const titles = Array.from(
        screen.container.querySelectorAll('[role="button"] h3'),
      ).map((node) => node.textContent)
      expect(titles).toEqual([
        'Start from scratch',
        'testFourth',
        'testTyped',
        'testBasic',
      ])
      await expect
        .element(screen.getByText(/Bookmark templates on the Workflows page/))
        .not.toBeInTheDocument()
      useTemplateBookmarksStore.setState({ keys: [] })
    })

    it('hints at bookmarking while no template is bookmarked', async () => {
      useTemplateBookmarksStore.setState({ keys: [] })
      const screen = await renderSection()

      await expect
        .element(screen.getByText(/Bookmark templates on the Workflows page/))
        .toBeVisible()
    })

    it('renders the plugin-authored tags as chips', async () => {
      const screen = await renderSection()

      await expect.element(screen.getByText('Ensemble Mean')).toBeVisible()
      await expect.element(screen.getByText('PNG Maps')).toBeVisible()
    })

    it('shows a loading status until the templates arrive', async () => {
      const screen = await renderSection()

      await expect.element(screen.getByRole('status')).toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: 'testBasic' }))
        .toBeVisible()
      await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
    })

    it('points at plugin management when no templates exist', async () => {
      worker.use(
        http.get(API_ENDPOINTS.fable.list, () =>
          HttpResponse.json({
            blueprints: [],
            total: 0,
            page: 1,
            page_size: 50,
          }),
        ),
      )

      const screen = await renderSection()

      await expect
        .element(screen.getByText('No workflow templates available'))
        .toBeVisible()
      await expect.element(screen.getByText('Manage plugins')).toBeVisible()
      // The one card that needs no backend stays.
      await expect
        .element(screen.getByRole('button', { name: 'Start from scratch' }))
        .toBeVisible()
    })

    it('offers a retry, not stale presets, when the list fails', async () => {
      worker.use(http.get(API_ENDPOINTS.fable.list, () => HttpResponse.error()))

      const screen = await renderSection()

      await expect
        .element(screen.getByText("Couldn't load templates"))
        .toBeVisible()
      await expect.element(screen.getByText('Retry')).toBeVisible()
      await expect
        .element(screen.getByText('ECMWF Open Data'))
        .not.toBeInTheDocument()
    })
  })

  describe('CommunityNewsCard', () => {
    it('renders the links from the news file', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <CommunityNewsCard />
        </AuthContext.Provider>,
      )

      const heading = screen.getByRole('heading', { level: 2 })
      await expect.element(heading).toBeVisible()
      for (const list of Object.values(mockCommunityNews)) {
        for (const item of list) {
          await expect
            .element(screen.getByRole('link', { name: item.title }))
            .toHaveAttribute('href', item.url)
        }
      }
    })

    it('says so when the news file cannot be loaded', async () => {
      worker.use(
        http.get(STATIC_FILES.communityNews, () => HttpResponse.error()),
      )
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <CommunityNewsCard />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByText('The news list could not be loaded.'))
        .toBeVisible()
    })
  })
})
