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

import i18n from 'i18next'
import type { ApiError, RequestConfig } from '@/types/api.types'
import { getBackendBaseUrl } from '@/utils/env'
import { parseOrThrow } from '@/utils/zod'
import { readAnonymousId } from '@/lib/anonymous-id'
import { createLogger } from '@/lib/logger'

const log = createLogger('ApiClient')

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
 *
 * Exported so direct-fetch callers (e.g. blob downloads in endpoints/job.ts)
 * resolve URLs identically to the apiClient.
 */
export function buildUrl(
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
 * Build an ApiClientError from a failed Response, preferring the FastAPI
 * `detail` body and falling back to `fallbackMessage`.
 */
export async function apiErrorFromResponse(
  response: Response,
  fallbackMessage: string,
): Promise<ApiClientError> {
  let message = fallbackMessage
  let details: unknown

  try {
    const errorData = (await response.json()) as ApiError
    // FastAPI errors are { detail }; our schema uses { message }.
    const detail = (errorData as unknown as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      message = errorData.message || detail || fallbackMessage
    } else if (typeof detail === 'object' && detail !== null) {
      message = errorData.message || fallbackMessage
      details = detail
    } else {
      message = errorData.message || fallbackMessage
    }
    if (!details) details = errorData.details
  } catch {
    // Body absent or not JSON — keep the fallback message.
  }

  return new ApiClientError(
    message,
    response.status,
    String(response.status),
    details,
  )
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

  // readAnonymousId yields the stored ID only if it is a valid UUID.
  const anonymousId = readAnonymousId()
  if (anonymousId) {
    requestHeaders['X-Anonymous-ID'] = anonymousId
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include', // Include session cookies
      // Fail closed on 3xx — a cross-origin redirect leaks X-Anonymous-ID.
      redirect: 'error',
    })

    // Handle non-200 responses
    if (!response.ok) {
      return Promise.reject(
        await apiErrorFromResponse(
          response,
          `HTTP ${response.status}: ${response.statusText}`,
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

    // Warn in development when response validation is skipped
    if (!schema && import.meta.env.DEV) {
      log.warn(
        `No schema for ${method} ${path} — response is not validated at runtime`,
      )
    }

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
        i18n.t('errors:network.apiUnreachable'),
        undefined,
        'NETWORK_ERROR',
        error,
      )
    }

    // Handle other errors
    throw new ApiClientError(
      error instanceof Error ? error.message : i18n.t('errors:unknown'),
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
