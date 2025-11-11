/**
 * API Client for FIAB backend
 * Provides a type-safe wrapper around fetch for making API requests
 * Supports optional Zod validation for runtime type safety
 */

import type { ApiError, RequestConfig } from '@/types/api.types'
import { getApiBaseUrl } from '@/utils/env'
import { parseOrThrow } from '@/utils/zod'

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
 * Supports both absolute URLs (standalone mode) and relative URLs (bundled mode)
 */
function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean>,
): string {
  const baseUrl = getApiBaseUrl()

  // Bundled mode: use relative URLs
  if (baseUrl === null) {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`

    // Build query string if params exist
    if (params) {
      const searchParams = new URLSearchParams()
      Object.entries(params).forEach(([key, value]) => {
        searchParams.append(key, String(value))
      })
      const queryString = searchParams.toString()
      return queryString ? `${normalizedPath}?${queryString}` : normalizedPath
    }
    return normalizedPath
  }

  // Standalone mode: use absolute URLs
  const url = new URL(path, baseUrl)

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value))
    })
  }

  return url.toString()
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

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
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

    // Handle empty responses
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      return {} as T
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
