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
 * API Client for FIAB backend
 *
 * Provides a type-safe wrapper around fetch for making API requests
 * with support for:
 * - Session-based authentication (HTTPOnly cookies)
 * - Anonymous user identification (X-Anonymous-ID header)
 * - Optional Zod validation for runtime type safety
 */

import type { ApiError, RequestConfig } from '@/types/api.types'
import { getBackendBaseUrl } from '@/utils/env'
import { parseOrThrow } from '@/utils/zod'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/**
 * Custom error class for API errors
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

/**
 * Build URL with query parameters
 *
 * API paths include /api/v1/ prefix (e.g., '/api/v1/status').
 * Base URL is either empty (same-origin) or absolute (remote backend).
 */
function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean>,
): string {
  const baseUrl = getBackendBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const fullPath = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}${normalizedPath}`
    : normalizedPath

  if (!params || Object.keys(params).length === 0) {
    return fullPath
  }

  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    searchParams.append(key, String(value))
  }
  return `${fullPath}?${searchParams.toString()}`
}

/**
 * Make an API request with optional Zod validation
 */
async function request<T>(
  path: string,
  config: RequestConfig = {},
): Promise<T> {
  const { method = 'GET', headers = {}, body, params, schema } = config

  const url = buildUrl(path, params)

  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...headers,
  }

  // Add X-Anonymous-ID header if anonymous ID exists in localStorage
  const anonymousId = localStorage.getItem(STORAGE_KEYS.auth.anonymousId)
  if (anonymousId) {
    requestHeaders['X-Anonymous-ID'] = anonymousId
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include', // Include session cookies
    })

    // Handle non-200 responses
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      let errorDetails: unknown

      try {
        const errorData = (await response.json()) as ApiError
        errorMessage = errorData.message || errorMessage
        errorDetails = errorData.details
      } catch {
        // If response is not JSON, use the status text
      }

      // Return early with error
      return Promise.reject(
        new ApiClientError(
          errorMessage,
          response.status,
          String(response.status),
          errorDetails,
        ),
      )
    }

    // Handle non-JSON responses
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      // No content-type or non-JSON: treat as void response
      // Common for DELETE, 202 Accepted, 204 No Content
      return undefined as T
    }

    const data = await response.json()

    // Validate with Zod schema if provided
    if (schema) {
      const validationResult = parseOrThrow(
        schema,
        data,
        `API response from ${method} ${path}`,
      )
      return validationResult as T
    }

    return data as T
  } catch (error) {
    // Re-throw ApiClientError
    if (error instanceof ApiClientError) {
      throw error
    }

    // Handle network errors
    if (error instanceof TypeError) {
      throw new ApiClientError(
        'Network error: Unable to reach the API server',
        undefined,
        'NETWORK_ERROR',
        error,
      )
    }

    // Handle other errors
    throw new ApiClientError(
      error instanceof Error ? error.message : 'An unknown error occurred',
      undefined,
      'UNKNOWN_ERROR',
      error,
    )
  }
}

/**
 * API client with HTTP methods
 */
export const apiClient = {
  get: <T>(path: string, config?: Omit<RequestConfig, 'method' | 'body'>) =>
    request<T>(path, { ...config, method: 'GET' }),

  post: <T>(
    path: string,
    body?: unknown,
    config?: Omit<RequestConfig, 'method' | 'body'>,
  ) => request<T>(path, { ...config, method: 'POST', body }),

  put: <T>(
    path: string,
    body?: unknown,
    config?: Omit<RequestConfig, 'method' | 'body'>,
  ) => request<T>(path, { ...config, method: 'PUT', body }),

  patch: <T>(
    path: string,
    body?: unknown,
    config?: Omit<RequestConfig, 'method' | 'body'>,
  ) => request<T>(path, { ...config, method: 'PATCH', body }),

  delete: <T>(path: string, config?: Omit<RequestConfig, 'method' | 'body'>) =>
    request<T>(path, { ...config, method: 'DELETE' }),
}
