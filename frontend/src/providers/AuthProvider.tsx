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
 * Authentication Provider
 *
 * Wraps the authentication provider from features/auth.
 * This provides a central location for auth context and makes it
 * easier to swap auth implementations in the future.
 */

import type { ReactNode } from 'react'
import { AuthProvider as FeatureAuthProvider } from '@/features/auth/AuthProvider.tsx'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Provider component for authentication
 * Re-exports the feature-specific AuthProvider for centralized access
 */
export function AuthProvider({ children }: AuthProviderProps) {
  return <FeatureAuthProvider>{children}</FeatureAuthProvider>
}
