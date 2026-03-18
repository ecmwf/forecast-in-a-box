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
 * Authentication Provider Factory
 *
 * Implements the Strategy Pattern to switch between authentication providers
 * based on runtime configuration.
 *
 * When authType === 'anonymous': Uses AnonymousAuthProvider
 * When authType === 'authenticated': Uses AuthenticatedAuthProvider (BFF OIDC)
 *
 * This allows the application to support different authentication mechanisms
 * without changing the code - just update the server configuration.
 */

import { AnonymousAuthProvider } from './AnonymousAuthProvider.tsx'
import { AuthenticatedAuthProvider } from './AuthenticatedAuthProvider.tsx'
import type { ReactNode } from 'react'
import { useConfig } from '@/hooks/useConfig'
import { createLogger } from '@/lib/logger'

const log = createLogger('AuthProvider')

interface AuthProviderProps {
  children: ReactNode
}

/**
 * AuthProvider Factory Component
 *
 * Selects and renders the appropriate authentication provider based on
 * the current configuration's authType.
 *
 * @example
 * ```tsx
 * // In main.tsx
 * <ConfigLoader>
 *   <AuthProvider>
 *     <App />
 *   </AuthProvider>
 * </ConfigLoader>
 * ```
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const config = useConfig()

  // Wait for config to load
  if (!config) {
    return null
  }

  // Switch based on auth type
  switch (config.authType) {
    case 'anonymous':
      return <AnonymousAuthProvider>{children}</AnonymousAuthProvider>

    case 'authenticated':
      if (!config.loginEndpoint) {
        log.error(
          'Authenticated auth type configured but loginEndpoint is missing. Falling back to anonymous auth.',
        )
        return <AnonymousAuthProvider>{children}</AnonymousAuthProvider>
      }
      return (
        <AuthenticatedAuthProvider loginEndpoint={config.loginEndpoint}>
          {children}
        </AuthenticatedAuthProvider>
      )

    default:
      log.error(
        `Unknown auth type: ${config.authType}. Falling back to anonymous auth.`,
      )
      return <AnonymousAuthProvider>{children}</AnonymousAuthProvider>
  }
}
