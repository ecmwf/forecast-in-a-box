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
 * Authentication Context Interface
 *
 * Defines the contract for authentication providers.
 * Both AnonymousAuthProvider and AuthenticatedAuthProvider implement this interface.
 */

import { createContext, useContext } from 'react'

/**
 * Authentication Context Value
 *
 * Provides authentication state and methods.
 *
 * Note: User data is fetched separately via useUser() hook.
 * Token/anonymous ID are internal to providers and apiClient.
 */
export interface AuthContextValue {
  /** Whether authentication is currently being initialized */
  isLoading: boolean

  /** Whether the user is authenticated (has session or anonymous ID) */
  isAuthenticated: boolean

  /** Authentication type ('authenticated' or 'anonymous') */
  authType: 'authenticated' | 'anonymous'

  /** Sign in method (redirects to login for authenticated, no-op for anonymous) */
  signIn: () => void

  /** Sign out method (clears session or generates new anonymous ID) */
  signOut: () => Promise<void>
}

/**
 * Authentication Context
 */
export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)

/**
 * Hook to access authentication context
 *
 * @throws Error if used outside of AuthProvider
 *
 * @example
 * ```typescript
 * const { user, isAuthenticated, signIn, signOut } = useAuth()
 * ```
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
