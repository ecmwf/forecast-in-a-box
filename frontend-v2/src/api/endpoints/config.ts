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
 * Configuration API Endpoints
 *
 * Handles loading runtime configuration from backend API with localStorage caching.
 *
 * Loading strategy:
 * 1. Check localStorage cache → use immediately if exists
 * 2. Fetch from /api/v1/admin/uiConfig (using build-time backendBaseUrl)
 * 3. Store in cache and configStore
 * 4. Background refresh if cache was used
 *
 * Build-time configuration (debug, backendBaseUrl) is in .env files - see src/utils/env.ts
 */

import type { AppConfig } from '@/types/config.types'
import { API_ENDPOINTS } from '@/api/endpoints'
import { appConfigSchema } from '@/types/config.types'
import { parseOrThrow } from '@/utils/zod'
import { useConfigStore } from '@/stores/configStore'
import { getBackendBaseUrl } from '@/utils/env'
import { createLogger } from '@/lib/logger'

const log = createLogger('Config')

/**
 * Request timeout for config fetch (5 seconds)
 */
const CONFIG_FETCH_TIMEOUT = 5000

/**
 * ========================================
 * FETCH CONFIG FROM API
 * ========================================
 */

/**
 * Fetch configuration from API with timeout
 *
 * @param url - Full URL to fetch config from
 * @returns Configuration from API
 * @throws Error if fetch fails or returns non-200 status
 */
async function fetchConfigWithTimeout(url: string): Promise<AppConfig> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(
        `Config API returned ${response.status}: ${response.statusText}`,
      )
    }

    const data = await response.json()

    // Validate API response with Zod
    return parseOrThrow(appConfigSchema, data, 'API config response')
  } catch (error) {
    clearTimeout(timeoutId)

    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Config fetch timeout after ${CONFIG_FETCH_TIMEOUT}ms`)
      }
      throw error
    }

    throw new Error(`Config fetch failed: ${String(error)}`)
  }
}

/**
 * Fetch configuration from API endpoint
 *
 * Uses build-time backendBaseUrl from environment variables
 *
 * @returns Configuration from API
 */
export async function fetchConfigFromAPI(): Promise<AppConfig> {
  const backendBaseUrl = getBackendBaseUrl()
  const url = `${backendBaseUrl.replace(/\/$/, '')}${API_ENDPOINTS.admin.uiConfig}`

  log.info('Fetching config from:', url)
  return await fetchConfigWithTimeout(url)
}

/**
 * ========================================
 * INITIALIZE CONFIGURATION
 * ========================================
 */

/**
 * Initialize configuration with cache-first strategy
 *
 * Loading strategy:
 * 1. Check if cached config exists in store (from localStorage)
 * 2. If cache exists: use immediately, refresh in background
 * 3. If no cache: fetch from API, store in cache
 * 4. Update store with loaded config
 *
 * @throws Error if fetch fails and no cache exists
 */
export async function initializeConfig(): Promise<void> {
  const configStore = useConfigStore.getState()

  // Check if we already have cached config
  const cachedConfig = configStore.config
  const isCacheValid = cachedConfig !== null

  if (isCacheValid) {
    log.info('Using cached config from localStorage')
    configStore.setConfig(cachedConfig, 'cache')

    // Try to refresh from API in the background (don't block)
    refreshConfigInBackground()
    return
  }

  // No cache - must load config synchronously before app can start
  log.info('No cached config found, loading fresh config...')

  configStore.setLoading(true)
  configStore.setError(null)

  try {
    const apiConfig = await fetchConfigFromAPI()
    log.info('Successfully loaded config from API')
    configStore.setConfig(apiConfig, 'api')
  } catch (error) {
    log.error('Failed to fetch config from API:', error)
    const errorObj = error instanceof Error ? error : new Error(String(error))
    configStore.setError(errorObj)
    throw errorObj
  }
}

/**
 * Refresh configuration from API in the background
 *
 * Used when cached config exists - we use cache immediately but
 * try to get fresh config from API without blocking
 */
async function refreshConfigInBackground(): Promise<void> {
  const configStore = useConfigStore.getState()

  try {
    const currentConfig = configStore.config
    if (!currentConfig) return

    const freshConfig = await fetchConfigFromAPI()

    // Only update if config actually changed
    if (JSON.stringify(freshConfig) !== JSON.stringify(currentConfig)) {
      log.info('Background refresh: Config changed, updating store')
      configStore.setConfig(freshConfig, 'api')
    } else {
      log.debug('Background refresh: Config unchanged')
    }
  } catch (error) {
    // Silent failure - we already have cached config, so this is not critical
    log.debug('Background refresh failed (using cached):', error)
  }
}

/**
 * ========================================
 * MANUAL REFRESH
 * ========================================
 */

/**
 * Manually refresh configuration from API
 *
 * Can be called by user action (e.g., refresh button)
 *
 * @returns Promise that resolves when config is refreshed
 */
export async function refreshConfig(): Promise<void> {
  const configStore = useConfigStore.getState()

  configStore.setLoading(true)
  configStore.setError(null)

  try {
    const freshConfig = await fetchConfigFromAPI()
    configStore.setConfig(freshConfig, 'api')
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error))
    configStore.setError(errorObj)
    throw errorObj
  }
}
