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
 * Layout Integration Tests
 *
 * Tests the layout components:
 * - PublicLayout renders header, content, and footer
 * - Footer renders expected links
 * - Header renders logo and navigation
 */

import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { AuthContext } from '@/features/auth/AuthContext'

// Mock useMedia to simulate desktop layout
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

describe('Layout', () => {
  describe('PublicLayout', () => {
    it('renders children within the layout', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <PublicLayout>
            <div data-testid="test-content">Hello World</div>
          </PublicLayout>
        </AuthContext.Provider>,
      )

      await expect
        .element(screen.getByTestId('test-content'))
        .toHaveTextContent('Hello World')
    })

    it('renders footer with expected links', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <PublicLayout>
            <div>Content</div>
          </PublicLayout>
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('ECMWF')).toBeVisible()
      await expect.element(screen.getByText('Destination Earth')).toBeVisible()
    })
  })

  describe('Header', () => {
    it('renders logo text', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Forecast-in-a-Box')).toBeVisible()
    })

    it('renders About navigation link', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Header />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('About')).toBeVisible()
    })
  })

  describe('Footer', () => {
    it('renders copyright notice', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Footer />
        </AuthContext.Provider>,
      )

      await expect
        .element(
          screen.getByText(
            /European Centre for Medium-Range Weather Forecasts/,
          ),
        )
        .toBeVisible()
    })

    it('renders external links with correct attributes', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Footer />
        </AuthContext.Provider>,
      )

      const ecmwfLink = screen.getByText('ECMWF')
      await expect.element(ecmwfLink).toBeVisible()
    })

    it('renders footer landmark', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Footer />
        </AuthContext.Provider>,
      )

      const footer = screen.getByRole('contentinfo')
      await expect.element(footer).toBeVisible()
    })
  })
})
