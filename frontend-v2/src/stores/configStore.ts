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
 * Configuration Store
 *
 * Zustand store for managing application configuration.
 * Handles loading config from API, caching to localStorage, and fallback to defaults.
 *
 * Features:
 * - Persistent storage via localStorage
 * - Async config loading with error handling
 * - Source tracking (API, cache, or default)
 * - Type-safe access to config values
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AppConfig,
  ConfigActions,
  ConfigSource,
  ConfigState,
} from '@/types/config.types'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

/**
 * Initial state
 */
const initialState: ConfigState = {
  config: null,
  isLoading: false,
  isLoaded: false,
  error: null,
  source: null,
  lastLoaded: null,
}

/**
 * Config Store
 *
 * Combined state and actions for configuration management
 */
export const useConfigStore = create<ConfigState & ConfigActions>()(
  persist(
    (set) => ({
      // State
      ...initialState,

      // Actions

      /**
       * Set the current configuration
       */
      setConfig: (config: AppConfig, source: ConfigSource) => {
        set({
          config,
          source,
          isLoaded: true,
          isLoading: false,
          error: null,
          lastLoaded: Date.now(),
        })
      },

      /**
       * Initialize and load configuration
       *
       * This will be called by ConfigLoader on app startup.
       * The actual loading logic is in configService.ts to keep
       * the store focused on state management.
       */
      loadConfig: async () => {
        // Import here to avoid circular dependencies
        const { initializeConfig } = await import('@/api/endpoints/config')

        set({ isLoading: true, error: null })

        try {
          await initializeConfig()
          // Config is set by config endpoint's initializeConfig via setConfig()
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error(String(error)),
            isLoading: false,
          })
          throw error
        }
      },

      /**
       * Reset configuration to initial state
       */
      resetConfig: () => {
        set(initialState)
      },

      /**
       * Set loading state
       */
      setLoading: (loading: boolean) => {
        set({ isLoading: loading })
      },

      /**
       * Set error state
       */
      setError: (error: Error | null) => {
        set({ error, isLoading: false })
      },
    }),
    {
      name: STORAGE_KEYS.stores.config,
      version: STORE_VERSIONS.config,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, _version) => {
        // Future migrations go here
        return persistedState as {
          config: AppConfig | null
          source: ConfigSource | null
          lastLoaded: number | null
        }
      },
      // Only persist the config itself, not the loading/error states
      partialize: (state) => ({
        config: state.config,
        source: state.source,
        lastLoaded: state.lastLoaded,
      }),
    },
  ),
)

/**
 * ========================================
 * SELECTORS
 * ========================================
 * Convenient selectors for accessing specific config values
 *
 * Note: Build-time configuration (backendBaseUrl, debug, environment) is now
 * in .env files - use functions from src/utils/env.ts instead
 */

/**
 * Get language code (ISO 639-1)
 */
export const selectLanguage = (state: ConfigState & ConfigActions) =>
  state.config?.language_iso639_1 ?? 'en'

/**
 * Get authentication type
 */
export const selectAuthType = (state: ConfigState & ConfigActions) =>
  state.config?.authType ?? 'anonymous'

/**
 * Get login endpoint for authenticated mode
 */
export const selectLoginEndpoint = (state: ConfigState & ConfigActions) =>
  state.config?.loginEndpoint ?? null

/**
 * Check if config is ready to use
 */
export const selectIsConfigReady = (state: ConfigState & ConfigActions) =>
  state.isLoaded && state.config !== null && !state.isLoading
