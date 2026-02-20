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
 * Config Loader Component
 *
 * Wrapper component that handles configuration initialization before
 * rendering the application.
 *
 * Loading Strategy:
 * 1. Check for cached config in localStorage
 *    - If found: render app immediately, refresh in background
 *    - If not found: show loading screen until config loaded
 * 2. Try to fetch from API (/api/v1/admin/uiConfig)
 * 3. Fall back to default JSON config if API fails
 * 4. Show error screen if all loading strategies fail
 *
 * The config is stored in Zustand configStore and persisted to localStorage.
 */

import { useEffect } from 'react'
import { LoadingSplashScreen } from './LoadingSplashScreen.tsx'
import type { ReactNode } from 'react'

import { createLogger } from '@/lib/logger'
import { selectIsConfigReady, useConfigStore } from '@/stores/configStore'

const log = createLogger('ConfigLoader')

interface ConfigLoaderProps {
  /** Children to render once config is loaded */
  children: ReactNode
}

export function ConfigLoader({ children }: ConfigLoaderProps) {
  const { isLoaded, isLoading, error, loadConfig } = useConfigStore()

  const isConfigReady = useConfigStore(selectIsConfigReady)

  // Initialize config on mount
  useEffect(() => {
    // Only load if not already loaded or loading
    if (!isLoaded && !isLoading) {
      loadConfig().catch((err) => {
        log.error('Failed to load config:', err)
      })
    }
  }, [isLoaded, isLoading, loadConfig])

  // Show loading screen while config is being loaded
  // (only shown on first load when no cache exists)
  if (isLoading && !isLoaded) {
    return <LoadingSplashScreen />
  }

  // Show error screen if config loading failed critically
  if (error && !isConfigReady) {
    return (
      <LoadingSplashScreen
        error={error.message}
        onRetry={() => {
          useConfigStore.getState().setError(null)
          loadConfig().catch((err) => {
            log.error('Retry failed:', err)
          })
        }}
      />
    )
  }

  // Config is ready - render the app
  if (isConfigReady) {
    return <>{children}</>
  }

  // Fallback: show loading (shouldn't normally reach here)
  return <LoadingSplashScreen />
}
