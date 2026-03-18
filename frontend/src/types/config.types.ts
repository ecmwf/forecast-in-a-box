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
 * Application Configuration Types and Schemas
 *
 * Configuration is loaded from the server API endpoint (/api/v1/admin/uiConfig) at runtime.
 * This allows "Build Once, Deploy Anywhere" without rebaking the JavaScript bundle.
 *
 * Loading Priority:
 * 1. Server API (/api/v1/admin/uiConfig) - Primary source
 * 2. localStorage cache - Used for faster subsequent loads
 *
 * Build-time configuration (debug, backendBaseUrl) is in .env files - see src/utils/env.ts
 */

import { z } from 'zod'

/**
 * Authentication Types
 * - 'anonymous': User identified by UUID, no login required
 * - 'authenticated': User must sign in via backend-managed OIDC flow
 */
export const AUTH_TYPES = ['authenticated', 'anonymous'] as const
export type AuthType = (typeof AUTH_TYPES)[number]

/**
 * ========================================
 * APPLICATION CONFIGURATION
 * ========================================
 */
export const appConfigSchema = z.object({
  /** Language code (ISO 639-1, e.g., 'en', 'de', 'fr') */
  language_iso639_1: z.string().default('en'),

  /** Authentication type */
  authType: z.enum(AUTH_TYPES).default('anonymous'),

  /**
   * Login endpoint path for authenticated mode
   * Backend will redirect to OIDC provider and set session cookie
   * Example: '/api/v1/auth/oidc/authorize'
   */
  loginEndpoint: z.string().optional().nullable(),
})

export type AppConfig = z.infer<typeof appConfigSchema>

/**
 * ========================================
 * CONFIG SOURCE TRACKING
 * ========================================
 */
export type ConfigSource =
  | 'api' // Loaded from API endpoint
  | 'cache' // Loaded from localStorage cache

/**
 * Config store state interface
 */
export interface ConfigState {
  /** Current configuration */
  config: AppConfig | null

  /** Whether config is currently being loaded */
  isLoading: boolean

  /** Whether config has been successfully loaded at least once */
  isLoaded: boolean

  /** Error that occurred during config loading, if any */
  error: Error | null

  /** Source from which config was loaded */
  source: ConfigSource | null

  /** Timestamp when config was last loaded */
  lastLoaded: number | null
}

/**
 * Config store actions interface
 */
export interface ConfigActions {
  /** Set the current configuration */
  setConfig: (config: AppConfig, source: ConfigSource) => void

  /** Initialize and load configuration */
  loadConfig: () => Promise<void>

  /** Reset configuration to initial state */
  resetConfig: () => void

  /** Set loading state */
  setLoading: (loading: boolean) => void

  /** Set error state */
  setError: (error: Error | null) => void
}

/**
 * ========================================
 * API RESPONSE SCHEMA
 * ========================================
 */
export const apiConfigResponseSchema = appConfigSchema

export type ApiConfigResponse = z.infer<typeof apiConfigResponseSchema>

/**
 * ========================================
 * HELPER TYPES
 * ========================================
 */

/**
 * Deep partial type for config overrides
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Config update type - allows partial updates
 */
export type ConfigUpdate = DeepPartial<AppConfig>
