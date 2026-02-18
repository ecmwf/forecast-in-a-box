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
 * Auth API Endpoints
 *
 * API functions for authentication operations.
 *
 * Note: These functions use direct fetch() instead of apiClient because
 * they may be called during auth initialization before the app is fully set up.
 */

import { API_ENDPOINTS } from '@/api/endpoints'
import { getBackendBaseUrl } from '@/utils/env'
import { createLogger } from '@/lib/logger'

const log = createLogger('AuthAPI')

/**
 * Response from the OIDC authorize endpoint
 */
interface OIDCAuthorizeResponse {
  authorization_url: string
}

/**
 * Check if user has valid session
 *
 * @returns True if session is valid
 */
export async function checkSession(): Promise<boolean> {
  const backendUrl = getBackendBaseUrl()

  try {
    const response = await fetch(`${backendUrl}${API_ENDPOINTS.users.me}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })

    return response.ok
  } catch (error) {
    log.error('Session check failed:', error)
    return false
  }
}

/**
 * Get the OIDC authorization URL from the backend
 *
 * @param loginEndpoint - Login endpoint path from config (e.g., '/api/v1/auth/oidc/authorize')
 * @returns Authorization URL to redirect to
 */
export async function getAuthorizationUrl(
  loginEndpoint: string,
): Promise<string> {
  const backendUrl = getBackendBaseUrl()

  try {
    // Ensure /api prefix is present (backend config may omit it)
    const normalizedEndpoint = loginEndpoint.startsWith('/api')
      ? loginEndpoint
      : `/api${loginEndpoint}`
    const response = await fetch(`${backendUrl}${normalizedEndpoint}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(
        `Failed to get authorization URL: ${response.status} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as OIDCAuthorizeResponse

    if (!data.authorization_url) {
      throw new Error('No authorization_url in response')
    }

    return data.authorization_url
  } catch (error) {
    log.error('Failed to get auth URL:', error)
    throw error
  }
}

/**
 * Logout the current user
 *
 * Invalidates the session on the backend
 *
 * @returns True if logout was successful
 */
export async function logout(): Promise<boolean> {
  const backendUrl = getBackendBaseUrl()

  try {
    const response = await fetch(`${backendUrl}${API_ENDPOINTS.auth.logout}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })

    if (response.ok) {
      log.info('Backend session invalidated successfully')
      return true
    } else {
      log.warn('Backend logout returned non-OK status:', response.status)
      return false
    }
  } catch (error) {
    log.error('Backend logout request failed:', error)
    return false
  }
}
