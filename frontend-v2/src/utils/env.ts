/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Type-safe environment variable access with Zod validation
 * Supports both build-time (VITE_*) and runtime (window.ENV_CONFIG) configuration
 *
 * Priority:
 * 1. Runtime config (window.ENV_CONFIG) - Can be changed without rebuild
 * 2. Build-time env vars (VITE_*) - Baked into the bundle at build time
 */

import { z } from 'zod'
import type { $ZodIssue } from 'zod/v4/core'

/**
 * Zod schema for build-time environment variables
 * Validates at runtime to catch configuration issues early
 */
const buildTimeEnvSchema = z.object({
  VITE_API_BASE_URL: z
    .string()
    .refine(
      (val) => val === '' || z.url().safeParse(val).success,
      'VITE_API_BASE_URL must be a valid URL or empty string for bundled mode',
    )
    .optional()
    .nullable()
    .transform((val) => val || null),
})

/**
 * Zod schema for runtime configuration
 * Loaded from public/config.js
 */
const runtimeConfigSchema = z.object({
  API_BASE_URL: z.union([z.url(), z.null()]).transform((val) => val || null),
  ENVIRONMENT: z.string().optional(),
  DEBUG: z.boolean().optional(),
})

/**
 * Validated build-time environment variables
 * Parsed once at module load time
 */
let validatedBuildTimeEnv: z.infer<typeof buildTimeEnvSchema> | null = null

/**
 * Validate and parse build-time environment variables
 * @throws ZodError if validation fails with detailed error messages
 */
function validateBuildTimeEnv() {
  if (validatedBuildTimeEnv) return validatedBuildTimeEnv

  try {
    validatedBuildTimeEnv = buildTimeEnvSchema.parse({
      VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    })
    return validatedBuildTimeEnv
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues
        .map((err: $ZodIssue) => `${err.path.join('.')}: ${err.message}`)
        .join('\n')
      throw new Error(
        `Build-time environment variable validation failed:\n${errorMessage}\n\nPlease check your .env file.`,
      )
    }
    throw error
  }
}

/**
 * Get and validate runtime configuration from window.ENV_CONFIG
 * Returns null if not available or invalid
 */
function getRuntimeConfig(): z.infer<typeof runtimeConfigSchema> | null {
  if (typeof window === 'undefined' || !window.ENV_CONFIG) {
    return null
  }

  try {
    return runtimeConfigSchema.parse(window.ENV_CONFIG)
  } catch (error) {
    console.warn('Invalid runtime configuration in window.ENV_CONFIG:', error)
    return null
  }
}

/**
 * Get API base URL from runtime config or build-time env
 * Returns null when in bundled mode (served from FastAPI)
 */
export function getApiBaseUrl(): string | null {
  // Runtime config takes precedence
  const runtimeConfig = getRuntimeConfig()
  if (runtimeConfig?.API_BASE_URL !== undefined) {
    return runtimeConfig.API_BASE_URL
  }

  // Fall back to build-time env
  return import.meta.env.VITE_API_BASE_URL || null
}

/**
 * Get the environment name
 * Priority: Runtime config > Build-time mode
 */
export function getEnvironment(): string {
  const runtimeConfig = getRuntimeConfig()
  if (runtimeConfig?.ENVIRONMENT) {
    return runtimeConfig.ENVIRONMENT
  }
  return import.meta.env.MODE
}

/**
 * Check if debug mode is enabled
 * Priority: Runtime config > Development mode
 */
export function isDebugEnabled(): boolean {
  const runtimeConfig = getRuntimeConfig()
  if (runtimeConfig?.DEBUG !== undefined) {
    return runtimeConfig.DEBUG
  }
  return import.meta.env.DEV
}

/**
 * Get all configuration values (for debugging)
 * Merges runtime config with build-time env vars
 */
export function getAllConfig() {
  const runtimeConfig = getRuntimeConfig()
  const buildTimeEnv = validateBuildTimeEnv()

  return {
    apiBaseUrl: getApiBaseUrl(),
    environment: getEnvironment(),
    debug: isDebugEnabled(),
    source: {
      runtime: runtimeConfig,
      buildTime: {
        apiBaseUrl: buildTimeEnv.VITE_API_BASE_URL,
        mode: import.meta.env.MODE,
      },
    },
  }
}

/**
 * Log configuration information to console (useful for debugging)
 * Only logs in development or when debug is enabled
 */
export function logConfig() {
  if (isDebugEnabled()) {
    console.group('🔧 Application Configuration')
    console.log('API Base URL:', getApiBaseUrl())
    console.log('Environment:', getEnvironment())
    console.log('Debug Mode:', isDebugEnabled())
    console.log('Full Config:', getAllConfig())
    console.groupEnd()
  }
}
