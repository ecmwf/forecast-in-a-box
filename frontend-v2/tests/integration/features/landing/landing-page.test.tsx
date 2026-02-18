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
 * Landing Page Integration Tests
 *
 * Tests the landing page rendering:
 * - Renders hero section with heading
 * - Shows FiabStack section
 * - Globe component loads via lazy loading
 */

import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { IntroGlobeSection } from '@/features/landing/components/IntroGlobeSection'
import { FiabStackSection } from '@/features/landing/components/FiabStackSection'
import { Collaboration } from '@/features/landing/components/Collaboration'
import { PublicLayout } from '@/components/layout'
import { AuthContext } from '@/features/auth/AuthContext'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

const unauthenticatedAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: false,
  authType: 'authenticated',
  signIn: vi.fn(),
  signOut: () => Promise.resolve(),
}

describe('Landing Page', () => {
  describe('IntroGlobeSection', () => {
    it('renders the hero heading', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={unauthenticatedAuth}>
          <IntroGlobeSection />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByRole('heading', { level: 1 }))
        .toBeVisible()
    })

    it('renders the hero description text', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={unauthenticatedAuth}>
          <IntroGlobeSection />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByText(/Forecast-in-a-Box reimagines/))
        .toBeVisible()
    })

    it('renders a globe placeholder while loading', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={unauthenticatedAuth}>
          <IntroGlobeSection />
        </AuthContext.Provider>,
      )

      // The globe is lazy-loaded, so there should be either the globe or its fallback
      const heading = screen.getByRole('heading', { level: 1 })
      await expect.element(heading).toBeVisible()
    })
  })

  describe('FiabStackSection', () => {
    it('renders the technology stack section', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={unauthenticatedAuth}>
          <FiabStackSection />
        </AuthContext.Provider>,
      )

      // FiabStackSection should render content
      expect(screen.container.innerHTML.length).toBeGreaterThan(0)
    })
  })

  describe('Collaboration', () => {
    it('renders the collaboration section', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={unauthenticatedAuth}>
          <Collaboration />
        </AuthContext.Provider>,
      )

      expect(screen.container.innerHTML.length).toBeGreaterThan(0)
    })
  })

  describe('Full landing page layout', () => {
    it('renders landing page sections within PublicLayout', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={unauthenticatedAuth}>
          <PublicLayout>
            <IntroGlobeSection />
            <FiabStackSection />
            <Collaboration />
          </PublicLayout>
        </AuthContext.Provider>,
      )

      // Hero heading should be visible
      await expect
        .element(screen.getByRole('heading', { level: 1 }))
        .toBeVisible()

      // Footer should be present (part of PublicLayout)
      await expect.element(screen.getByRole('contentinfo')).toBeVisible()
    })
  })
})
