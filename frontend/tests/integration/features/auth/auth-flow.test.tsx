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
 * Auth Flow Integration Tests
 *
 * Tests the authentication provider selection and behavior:
 * - Anonymous auth: renders children with anonymous context
 * - Authenticated auth: checks session and provides authenticated context
 * - Auth fallback: falls back to anonymous when config is misconfigured
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { HttpResponse, http } from 'msw'
import { renderWithProviders } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth } from '@/features/auth/AuthContext'
import { useConfigStore } from '@/stores/configStore'
import { API_ENDPOINTS } from '@/api/endpoints'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/**
 * Test component that displays auth context values
 */
function AuthStatus() {
  const { isLoading, isAuthenticated, authType } = useAuth()

  if (isLoading) {
    return <div data-testid="auth-status">loading</div>
  }

  return (
    <div data-testid="auth-status">
      <span data-testid="auth-type">{authType}</span>
      <span data-testid="auth-authenticated">
        {isAuthenticated ? 'yes' : 'no'}
      </span>
    </div>
  )
}

describe('Auth Flow', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset config store
    useConfigStore.setState({ config: null, error: null })
  })

  describe('Anonymous auth', () => {
    beforeEach(() => {
      useConfigStore.setState({
        config: {
          language_iso639_1: 'en',
          authType: 'anonymous',
          loginEndpoint: null,
        },
      })
    })

    it('renders children with anonymous auth context', async () => {
      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      await expect
        .element(screen.getByTestId('auth-type'))
        .toHaveTextContent('anonymous')
      await expect
        .element(screen.getByTestId('auth-authenticated'))
        .toHaveTextContent('yes')
    })

    it('generates an anonymous ID in localStorage', async () => {
      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      await expect
        .element(screen.getByTestId('auth-type'))
        .toHaveTextContent('anonymous')

      const anonymousId = localStorage.getItem(STORAGE_KEYS.auth.anonymousId)
      expect(anonymousId).toBeTruthy()
      expect(anonymousId!.length).toBeGreaterThan(0)
    })

    it('persists anonymous ID across renders', async () => {
      // Set up a pre-existing ID
      localStorage.setItem(STORAGE_KEYS.auth.anonymousId, 'existing-id-123')

      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      await expect
        .element(screen.getByTestId('auth-authenticated'))
        .toHaveTextContent('yes')

      expect(localStorage.getItem(STORAGE_KEYS.auth.anonymousId)).toBe(
        'existing-id-123',
      )
    })
  })

  describe('Authenticated auth', () => {
    beforeEach(() => {
      useConfigStore.setState({
        config: {
          language_iso639_1: 'en',
          authType: 'authenticated',
          loginEndpoint: '/api/v1/auth/login',
        },
      })
    })

    it('shows authenticated context when session is valid', async () => {
      // Mock session check to return valid session
      worker.use(
        http.get(`*${API_ENDPOINTS.users.me}`, () => {
          return HttpResponse.json({
            id: 'user-1',
            email: 'test@example.com',
            is_active: true,
            is_superuser: false,
            is_verified: true,
          })
        }),
      )

      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      await expect
        .element(screen.getByTestId('auth-type'))
        .toHaveTextContent('authenticated')
    })
  })

  describe('Auth fallback', () => {
    it('falls back to anonymous when authenticated type has no loginEndpoint', async () => {
      useConfigStore.setState({
        config: {
          language_iso639_1: 'en',
          authType: 'authenticated',
          loginEndpoint: null,
        },
      })

      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      // Should fall back to anonymous since loginEndpoint is missing
      await expect
        .element(screen.getByTestId('auth-type'))
        .toHaveTextContent('anonymous')
      await expect
        .element(screen.getByTestId('auth-authenticated'))
        .toHaveTextContent('yes')
    })

    it('falls back to anonymous for unknown auth type', async () => {
      useConfigStore.setState({
        config: {
          language_iso639_1: 'en',
          authType: 'unknown-type' as any,
          loginEndpoint: null,
        },
      })

      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      await expect
        .element(screen.getByTestId('auth-type'))
        .toHaveTextContent('anonymous')
    })

    it('renders nothing when config is not loaded', async () => {
      // Config is null (not loaded yet)
      useConfigStore.setState({ config: null })

      const screen = await renderWithProviders(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      )

      // AuthProvider should return null when config is not loaded
      const el = screen.container.querySelector('[data-testid="auth-status"]')
      expect(el).toBeNull()
    })
  })
})
