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
 * useConfig Hook
 *
 * Provides typed access to application configuration.
 *
 * Runtime configuration (from API):
 * - useLanguage()
 * - useAuthType()
 * - useLoginEndpoint()
 *
 * Build-time configuration (from .env):
 * - useBackendBaseUrl()
 * - useDebugMode()
 * - useEnvironment()
 *
 * Usage:
 * ```typescript
 * const config = useConfig()
 * const language = useLanguage()
 * const authType = useAuthType()
 * const backendUrl = useBackendBaseUrl()
 * ```
 */

import type { AppConfig } from '@/types/config.types'
import {
  selectAuthType,
  selectIsConfigReady,
  selectLanguage,
  selectLoginEndpoint,
  useConfigStore,
} from '@/stores/configStore'
import { getBackendBaseUrl, getEnvironment, isDebugEnabled } from '@/utils/env'

/**
 * Get complete application configuration
 *
 * @returns Full app config object (or null if not loaded)
 */
export function useConfig(): AppConfig | null {
  return useConfigStore((state) => state.config)
}

/**
 * ========================================
 * RUNTIME CONFIGURATION (from API)
 * ========================================
 */

/**
 * Get language code
 *
 * @returns Language code (ISO 639-1, defaults to 'en')
 */
export function useLanguage(): string {
  return useConfigStore(selectLanguage)
}

/**
 * Get authentication type
 *
 * @returns Auth type ('authenticated' or 'anonymous', defaults to 'anonymous')
 */
export function useAuthType() {
  return useConfigStore(selectAuthType)
}

/**
 * Get login endpoint for authenticated mode
 *
 * @returns Login endpoint path or null
 */
export function useLoginEndpoint(): string | null {
  return useConfigStore(selectLoginEndpoint)
}

/**
 * ========================================
 * BUILD-TIME CONFIGURATION (from .env)
 * ========================================
 */

/**
 * Get backend base URL
 *
 * This is a build-time environment variable set via VITE_BACKEND_BASE_URL
 *
 * @returns Backend base URL (e.g., '/api' or 'http://127.0.0.1:8000/api')
 */
export function useBackendBaseUrl(): string {
  return getBackendBaseUrl()
}

/**
 * Get debug mode flag
 *
 * This is a build-time environment variable set via VITE_DEBUG
 *
 * @returns Whether debug mode is enabled
 */
export function useDebugMode(): boolean {
  return isDebugEnabled()
}

/**
 * Get environment name
 *
 * This is Vite's built-in MODE (development/production)
 *
 * @returns Environment name (e.g., 'development', 'production')
 */
export function useEnvironment(): string {
  return getEnvironment()
}

/**
 * ========================================
 * CONFIG STATE
 * ========================================
 */

/**
 * Check if configuration is ready to use
 *
 * @returns Whether config is loaded and ready
 */
export function useIsConfigReady(): boolean {
  return useConfigStore(selectIsConfigReady)
}

/**
 * Get config loading state
 *
 * @returns Whether config is currently being loaded
 */
export function useIsConfigLoading(): boolean {
  return useConfigStore((state) => state.isLoading)
}

/**
 * Get config error state
 *
 * @returns Error that occurred during config loading, if any
 */
export function useConfigError(): Error | null {
  return useConfigStore((state) => state.error)
}

/**
 * Get config source
 *
 * @returns Source from which config was loaded ('api' or 'cache')
 */
export function useConfigSource() {
  return useConfigStore((state) => state.source)
}
