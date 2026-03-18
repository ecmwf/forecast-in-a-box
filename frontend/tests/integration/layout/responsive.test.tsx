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
 * Responsive Layout Integration Tests
 *
 * Tests viewport-dependent layout changes by toggling the useMedia mock
 * between desktop (true) and mobile (false) modes.
 *
 * - Header shows inline nav links on desktop, hamburger menu on mobile
 * - Mobile menu can be toggled open/closed
 * - PublicLayout renders responsive header correctly in both modes
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { Header } from '@/components/layout/Header'
import { PublicLayout } from '@/components/layout'

// Mutable flag to toggle between desktop and mobile per test
let isDesktop = true
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => isDesktop,
}))

const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

describe('Responsive Layout', () => {
  beforeEach(() => {
    isDesktop = true
  })

  describe('Header - Desktop', () => {
    it('renders inline navigation links on desktop', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('About')).toBeVisible()
    })

    it('renders logo and app title on desktop', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Forecast-in-a-Box')).toBeVisible()
    })

    it('hides mobile menu button via CSS on desktop', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      // The hamburger button is always in the DOM but hidden via lg:hidden CSS class
      const menuButton = screen.container.querySelector(
        '[aria-label="Open Menu"]',
      )
      expect(menuButton).toBeTruthy()
      expect(menuButton?.classList.contains('lg:hidden')).toBe(true)
    })
  })

  describe('Header - Mobile', () => {
    it('renders mobile menu button on small viewport', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByLabelText('Open Menu'))
        .toBeInTheDocument()
    })

    it('does not show inline nav links on mobile', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      // The inline desktop menu items should not be rendered
      // (mobile nav only appears after toggling the hamburger menu)
      const nav = screen.container.querySelector('nav[role="navigation"]')
      expect(nav).toBeNull()
    })

    it('renders logo and app title on mobile', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Forecast-in-a-Box')).toBeVisible()
    })

    it('opens mobile menu when hamburger is clicked', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      const menuButton = screen.getByLabelText('Open Menu')
      await menuButton.click()

      // After opening, the mobile navigation should appear
      const nav = screen.container.querySelector('nav[role="navigation"]')
      expect(nav).toBeTruthy()
    })

    it('shows mobile nav links after opening the menu', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      const menuButton = screen.getByLabelText('Open Menu')
      await menuButton.click()

      await expect.element(screen.getByText('About')).toBeVisible()
    })

    it('toggles menu button label to Close Menu when opened', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      const menuButton = screen.getByLabelText('Open Menu')
      await menuButton.click()

      await expect
        .element(screen.getByLabelText('Close Menu'))
        .toBeInTheDocument()
    })

    it('sets header data-state to active when mobile menu is open', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      const menuButton = screen.getByLabelText('Open Menu')
      await menuButton.click()

      const header = screen.getByRole('banner')
      await expect.element(header).toHaveAttribute('data-state', 'active')
    })
  })

  describe('PublicLayout - responsive', () => {
    it('renders header and footer on desktop', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <PublicLayout>
            <div data-testid="content">Page Content</div>
          </PublicLayout>
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Forecast-in-a-Box')).toBeVisible()
      await expect.element(screen.getByText('ECMWF')).toBeVisible()
      await expect.element(screen.getByTestId('content')).toBeVisible()
    })

    it('renders header with mobile menu button on small viewport', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <PublicLayout>
            <div data-testid="content">Page Content</div>
          </PublicLayout>
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByLabelText('Open Menu'))
        .toBeInTheDocument()
      await expect.element(screen.getByTestId('content')).toBeVisible()
    })

    it('still renders footer on mobile', async () => {
      isDesktop = false
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <PublicLayout>
            <div>Content</div>
          </PublicLayout>
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByRole('contentinfo')).toBeVisible()
    })
  })
})
