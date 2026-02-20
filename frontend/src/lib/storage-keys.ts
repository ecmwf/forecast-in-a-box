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
 * Client-Side Storage Keys
 *
 * Single source of truth for all localStorage keys and Zustand persistence keys.
 * All client-side storage uses the `fiab.` namespace prefix for consistency
 * and to avoid collisions with other applications.
 *
 * Key naming convention:
 * - Prefix: `fiab.`
 * - Categories: `auth` (authentication), `store` (Zustand stores)
 * - Format: `fiab.{category}.{name}` using kebab-case
 *
 * @see AGENTS.md for full documentation on storage conventions
 */

/**
 * Storage key constants - single source of truth
 *
 * Usage:
 * ```typescript
 * import { STORAGE_KEYS } from '@/lib/storage-keys'
 *
 * localStorage.getItem(STORAGE_KEYS.auth.anonymousId)
 * ```
 */
export const STORAGE_KEYS = {
  /**
   * Authentication-related storage keys (direct localStorage)
   */
  auth: {
    /** Tracks whether user explicitly logged out (authenticated mode only) */
    logoutFlag: 'fiab.auth.logout-flag',
    /** Anonymous user UUID persisted across sessions */
    anonymousId: 'fiab.auth.anonymous-id',
    /** Post-login redirect URL for deep linking */
    redirectUrl: 'fiab.auth.redirect-url',
  },

  /**
   * Fable-related storage keys (direct localStorage)
   */
  fable: {
    /** Metadata for saved fable configurations (title, comments, summary) */
    metadata: 'fiab.fable.metadata',
  },

  /**
   * Zustand store persistence keys
   */
  stores: {
    /** UI preferences (theme, layout) */
    ui: 'fiab.store.ui',
    /** Cached application configuration */
    config: 'fiab.store.config',
    /** Fable builder UI preferences */
    fableBuilder: 'fiab.store.fable-builder',
    /** Client-side job metadata (name, description, tags, fable snapshot) */
    jobMetadata: 'fiab.store.job-metadata',
  },
} as const

/**
 * Store versions for Zustand persist middleware
 *
 * Increment when schema changes require migration.
 * The `migrate` function in each store handles transformations.
 *
 * Usage:
 * ```typescript
 * import { STORE_VERSIONS } from '@/lib/storage-keys'
 *
 * persist(store, {
 *   version: STORE_VERSIONS.ui,
 *   migrate: (state, version) => { ... }
 * })
 * ```
 */
export const STORE_VERSIONS = {
  ui: 4, // v4: Removed sidebar state
  config: 1,
  fableBuilder: 2, // v2: Removed configDisplayMode, added isMiniMapOpen
  jobMetadata: 1,
} as const

/**
 * Clear all FIAB storage keys
 *
 * Useful for debugging or complete logout/reset scenarios.
 * Removes all keys with the `fiab.` prefix.
 */
export function clearAllFiabStorage(): void {
  const keysToRemove: Array<string> = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('fiab.')) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }
}
