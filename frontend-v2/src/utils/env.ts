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
 * Type-safe environment variable access for build-time configuration
 *
 * These values are baked into the bundle at build time via Vite's env system.
 * They cannot be changed without rebuilding the application.
 *
 * For runtime configuration (language, authType, etc.), see configStore.
 */

/**
 * Get the backend base URL
 *
 * This value is set at build time via VITE_API_BASE_URL env var.
 * Default: '' (empty, since API paths already include /api/v1/ prefix)
 *
 * Use an absolute URL (e.g., 'http://localhost:8000') when connecting
 * to a backend on a different origin.
 *
 * @returns Backend API base URL (e.g., '' or 'http://localhost:8000')
 */
import { createLogger } from '@/lib/logger'

export function getBackendBaseUrl(): string {
  // Use nullish coalescing to preserve empty string as a valid value
  return import.meta.env.VITE_API_BASE_URL ?? ''
}

/**
 * Check if debug mode is enabled
 *
 * This value is set at build time via VITE_DEBUG env var.
 * Default: false
 *
 * @returns True if debug logging should be enabled
 */
export function isDebugEnabled(): boolean {
  const debugValue = import.meta.env.VITE_DEBUG
  // Vite env vars are always strings, so check for 'true' string
  return debugValue === 'true'
}

/**
 * Get the environment name
 *
 * This uses Vite's built-in MODE which is automatically set based on
 * the command used (dev = 'development', build = 'production', etc.)
 *
 * @returns Environment name (e.g., 'development', 'production')
 */
export function getEnvironment(): string {
  return import.meta.env.MODE
}

/**
 * Check if running in production mode
 *
 * @returns True if in production build
 */
export function isProduction(): boolean {
  return import.meta.env.PROD
}

/**
 * Check if running in development mode
 *
 * @returns True if in development mode
 */
export function isDevelopment(): boolean {
  return import.meta.env.DEV
}

const log = createLogger('Environment')

/**
 * Log environment configuration (for debugging)
 * Only logs in development or when debug is enabled
 */
export function logEnvironmentConfig(): void {
  if (isDevelopment() || isDebugEnabled()) {
    log.debug('Build-Time Environment Configuration', {
      backendBaseUrl: getBackendBaseUrl(),
      debugMode: isDebugEnabled(),
      environment: getEnvironment(),
      production: isProduction(),
      development: isDevelopment(),
    })
  }
}
