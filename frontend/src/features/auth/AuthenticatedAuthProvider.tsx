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
 * Authenticated Auth Provider
 *
 * Uses backend-as-frontend (BFF) pattern:
 * - Backend handles OIDC flow and sets HTTPOnly session cookies
 * - Frontend checks session via /users/me endpoint
 * - No client-side token management
 *
 * Security benefits:
 * - HTTPOnly cookies prevent XSS token theft
 * - No PKCE flow complexity on frontend
 * - Backend owns authentication logic
 */

import React, { useEffect, useState } from 'react'
import { AuthContext } from './AuthContext.tsx'
import type { AuthContextValue } from './AuthContext.tsx'
import { createLogger } from '@/lib/logger'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { checkSession, getAuthorizationUrl, logout } from '@/api/endpoints/auth'

const log = createLogger('AuthenticatedAuthProvider')

interface AuthenticatedAuthProviderProps {
  children: React.ReactNode
  loginEndpoint: string
}

/**
 * Authenticated Auth Provider
 *
 * Manages session-based authentication via backend OIDC flow
 */
export function AuthenticatedAuthProvider({
  children,
  loginEndpoint,
}: AuthenticatedAuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  // Check session on mount
  useEffect(() => {
    async function initializeAuth() {
      setIsLoading(true)

      // Check if user explicitly logged out
      const userLoggedOut =
        localStorage.getItem(STORAGE_KEYS.auth.logoutFlag) === 'true'

      if (userLoggedOut) {
        log.info('User previously logged out, staying logged out')
        setIsAuthenticated(false)
        setIsLoading(false)
        return
      }

      // Only check session if user didn't explicitly log out
      const hasValidSession = await checkSession()

      if (hasValidSession) {
        log.info('Valid session found')
        setIsAuthenticated(true)
      } else {
        log.info('No valid session')
        setIsAuthenticated(false)
      }

      setIsLoading(false)
    }

    initializeAuth()
  }, [loginEndpoint])

  /**
   * Sign in - fetch authorization URL and redirect
   */
  const signIn = async () => {
    try {
      // Clear logout flag - user is explicitly logging in
      localStorage.removeItem(STORAGE_KEYS.auth.logoutFlag)
      log.info('Logout flag cleared, user is logging in')

      const authUrl = await getAuthorizationUrl(loginEndpoint)
      log.info('Redirecting to login:', authUrl)
      window.location.href = authUrl
    } catch (error) {
      log.error('Sign in failed:', error)
    }
  }

  /**
   * Sign out - invalidate session on backend and clear local session
   */
  const signOut = async () => {
    log.info('Starting logout process...')

    // Call backend logout endpoint to invalidate session server-side
    await logout()

    // Set logout flag - prevents auto-login on redirect
    localStorage.setItem(STORAGE_KEYS.auth.logoutFlag, 'true')
    log.info('Logout flag set - user will stay logged out')

    // Clear local authentication state
    setIsAuthenticated(false)
    log.debug('Local auth state cleared')

    // Redirect to home page with full page reload
    // This ensures:
    // 1. All React state is cleared
    // 2. Auth check runs and sees logout flag
    // 3. User stays logged out
    // 4. Landing page displays correctly
    log.info('Redirecting to home page...')
    window.location.href = '/'
  }

  const contextValue: AuthContextValue = {
    isLoading,
    isAuthenticated,
    authType: 'authenticated',
    signIn,
    signOut,
  }

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  )
}
