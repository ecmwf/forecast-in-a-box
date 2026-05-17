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
 * Anonymous Authentication Provider
 *
 * Implements authentication for anonymous users by generating a UUID
 * and storing it in localStorage. The UUID persists across sessions.
 *
 * The UUID is sent to backend via X-Anonymous-ID header (handled by apiClient).
 *
 * This provider is used when config.authType === 'anonymous'.
 */

import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { AuthContext } from './AuthContext.tsx'
import type { ReactNode } from 'react'
import type { AuthContextValue } from './AuthContext.tsx'
import { readAnonymousId } from '@/lib/anonymous-id'
import { createLogger } from '@/lib/logger'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { removeStorage, writeStorage } from '@/lib/storage'

const log = createLogger('AnonymousAuth')

interface AnonymousAuthProviderProps {
  children: ReactNode
}

/**
 * Get or create anonymous user ID
 */
function getOrCreateAnonymousUserId(): string {
  // Reuse the stored ID only if it is a valid UUID, else regenerate below.
  const existingId = readAnonymousId()

  if (existingId) {
    return existingId
  }

  // Generate new UUID
  const newId = uuidv4()
  writeStorage(STORAGE_KEYS.auth.anonymousId, newId)
  log.info('Generated new anonymous ID:', newId)
  return newId
}

/**
 * Anonymous Authentication Provider Component
 */
export function AnonymousAuthProvider({
  children,
}: AnonymousAuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true)

  // Initialize anonymous user ID
  useEffect(() => {
    // Get or create anonymous ID
    getOrCreateAnonymousUserId()

    setIsLoading(false)
  }, [])

  // Anonymous auth methods
  const signIn = () => {
    // Anonymous users are always "signed in"
    log.debug('Sign in called (no-op for anonymous auth)')
  }

  const signOut = () => {
    // Clear the stored UUID and generate a new one
    removeStorage(STORAGE_KEYS.auth.anonymousId)
    getOrCreateAnonymousUserId()
    log.info('Signed out - new anonymous ID generated')

    // Reload page to reset application state
    window.location.reload()
    return Promise.resolve()
  }

  const contextValue: AuthContextValue = {
    isLoading,
    isAuthenticated: true, // Anonymous users are always "authenticated"
    authType: 'anonymous',
    signIn,
    signOut,
  }

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  )
}
