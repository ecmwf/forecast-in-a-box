/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { worker } from '@tests/../mocks/browser'
import { ApiClientError, apiClient } from '@/api/client'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// Mock the env module to control backend URL
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  describe('GET requests', () => {
    it('makes GET request and returns data', async () => {
      const mockData = { id: 1, name: 'test' }
      worker.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.json(mockData)
        }),
      )

      const result = await apiClient.get('/api/v1/test')
      expect(result).toEqual(mockData)
    })

    it('includes query parameters in URL', async () => {
      let capturedUrl: string | null = null
      worker.use(
        http.get('/api/v1/test', ({ request }) => {
          capturedUrl = request.url
          return HttpResponse.json({ success: true })
        }),
      )

      await apiClient.get('/api/v1/test', {
        params: { foo: 'bar', count: 42, enabled: true },
      })

      expect(capturedUrl).toContain('foo=bar')
      expect(capturedUrl).toContain('count=42')
      expect(capturedUrl).toContain('enabled=true')
    })

    it('sends JSON content-type and accept headers', async () => {
      let capturedHeaders: Headers | null = null
      worker.use(
        http.get('/api/v1/test', ({ request }) => {
          capturedHeaders = new Headers(request.headers)
          return HttpResponse.json({})
        }),
      )

      await apiClient.get('/api/v1/test')

      expect(capturedHeaders!.get('Content-Type')).toBe('application/json')
      expect(capturedHeaders!.get('Accept')).toBe('application/json')
    })

    it('includes X-Anonymous-ID header when present in localStorage', async () => {
      localStorage.setItem(STORAGE_KEYS.auth.anonymousId, 'anon-123')

      let capturedHeaders: Headers | null = null
      worker.use(
        http.get('/api/v1/test', ({ request }) => {
          capturedHeaders = new Headers(request.headers)
          return HttpResponse.json({})
        }),
      )

      await apiClient.get('/api/v1/test')

      expect(capturedHeaders!.get('X-Anonymous-ID')).toBe('anon-123')
    })

    it('does not include X-Anonymous-ID header when not in localStorage', async () => {
      let capturedHeaders: Headers | null = null
      worker.use(
        http.get('/api/v1/test', ({ request }) => {
          capturedHeaders = new Headers(request.headers)
          return HttpResponse.json({})
        }),
      )

      await apiClient.get('/api/v1/test')

      expect(capturedHeaders!.get('X-Anonymous-ID')).toBeNull()
    })
  })

  describe('POST requests', () => {
    it('makes POST request with body', async () => {
      let capturedBody: unknown = null
      worker.use(
        http.post('/api/v1/test', async ({ request }) => {
          capturedBody = await request.json()
          return HttpResponse.json({ success: true })
        }),
      )

      const body = { name: 'test', value: 123 }
      await apiClient.post('/api/v1/test', body)

      expect(capturedBody).toEqual(body)
    })

    it('makes POST request without body', async () => {
      worker.use(
        http.post('/api/v1/test', () => {
          return HttpResponse.json({ success: true })
        }),
      )

      const result = await apiClient.post('/api/v1/test')
      expect(result).toEqual({ success: true })
    })
  })

  describe('PUT requests', () => {
    it('makes PUT request with body', async () => {
      let capturedBody: unknown = null
      worker.use(
        http.put('/api/v1/test', async ({ request }) => {
          capturedBody = await request.json()
          return HttpResponse.json({ success: true })
        }),
      )

      const body = { name: 'updated' }
      await apiClient.put('/api/v1/test', body)

      expect(capturedBody).toEqual(body)
    })
  })

  describe('PATCH requests', () => {
    it('makes PATCH request with body', async () => {
      let capturedBody: unknown = null
      worker.use(
        http.patch('/api/v1/test', async ({ request }) => {
          capturedBody = await request.json()
          return HttpResponse.json({ success: true })
        }),
      )

      const body = { field: 'patched' }
      await apiClient.patch('/api/v1/test', body)

      expect(capturedBody).toEqual(body)
    })
  })

  describe('DELETE requests', () => {
    it('makes DELETE request', async () => {
      worker.use(
        http.delete('/api/v1/test/123', () => {
          return HttpResponse.json({ deleted: true })
        }),
      )

      const result = await apiClient.delete('/api/v1/test/123')
      expect(result).toEqual({ deleted: true })
    })
  })

  describe('error handling', () => {
    it('throws ApiClientError for 4xx errors', async () => {
      worker.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.json(
            { message: 'Not found', details: { id: '123' } },
            { status: 404 },
          )
        }),
      )

      await expect(apiClient.get('/api/v1/test')).rejects.toThrow(
        ApiClientError,
      )

      try {
        await apiClient.get('/api/v1/test')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError)
        const apiError = error as ApiClientError
        expect(apiError.status).toBe(404)
        expect(apiError.message).toBe('Not found')
        expect(apiError.details).toEqual({ id: '123' })
      }
    })

    it('throws ApiClientError for 5xx errors', async () => {
      worker.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.json(
            { message: 'Internal server error' },
            { status: 500 },
          )
        }),
      )

      try {
        await apiClient.get('/api/v1/test')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError)
        const apiError = error as ApiClientError
        expect(apiError.status).toBe(500)
      }
    })

    it('handles non-JSON error responses', async () => {
      worker.use(
        http.get('/api/v1/test', () => {
          return new HttpResponse('Internal Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'text/plain' },
          })
        }),
      )

      try {
        await apiClient.get('/api/v1/test')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError)
        const apiError = error as ApiClientError
        expect(apiError.status).toBe(500)
        expect(apiError.message).toContain('500')
      }
    })

    it('throws ApiClientError for network errors', async () => {
      worker.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.error()
        }),
      )

      try {
        await apiClient.get('/api/v1/test')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError)
        const apiError = error as ApiClientError
        expect(apiError.code).toBe('NETWORK_ERROR')
      }
    })
  })

  describe('Zod schema validation', () => {
    it('validates response with provided schema', async () => {
      const schema = z.object({
        id: z.number(),
        name: z.string(),
      })

      worker.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.json({ id: 1, name: 'test' })
        }),
      )

      const result = await apiClient.get('/api/v1/test', { schema })
      expect(result).toEqual({ id: 1, name: 'test' })
    })

    it('throws error when response fails schema validation', async () => {
      const schema = z.object({
        id: z.number(),
        name: z.string(),
      })

      worker.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.json({ id: 'not-a-number', name: 123 })
        }),
      )

      await expect(apiClient.get('/api/v1/test', { schema })).rejects.toThrow()
    })
  })

  describe('non-JSON responses', () => {
    it('returns undefined for non-JSON content-type', async () => {
      worker.use(
        http.get('/api/v1/test', () => {
          return new HttpResponse('OK', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        }),
      )

      const result = await apiClient.get('/api/v1/test')
      expect(result).toBeUndefined()
    })

    it('returns undefined for 204 no-content response', async () => {
      worker.use(
        http.get('/api/v1/test', () => {
          return new HttpResponse(null, { status: 204 })
        }),
      )

      const result = await apiClient.get('/api/v1/test')
      expect(result).toBeUndefined()
    })

    it('returns undefined for 202 accepted with no body', async () => {
      worker.use(
        http.post('/api/v1/test', () => {
          return new HttpResponse(null, { status: 202 })
        }),
      )

      const result = await apiClient.post('/api/v1/test', { id: '123' })
      expect(result).toBeUndefined()
    })

    it('returns undefined for DELETE with non-JSON response', async () => {
      worker.use(
        http.delete('/api/v1/test/456', () => {
          return new HttpResponse(null, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        }),
      )

      const result = await apiClient.delete('/api/v1/test/456')
      expect(result).toBeUndefined()
    })
  })
})

describe('ApiClientError', () => {
  it('creates error with all properties', () => {
    const error = new ApiClientError('Test error', 404, 'NOT_FOUND', {
      detail: 'extra info',
    })

    expect(error.name).toBe('ApiClientError')
    expect(error.message).toBe('Test error')
    expect(error.status).toBe(404)
    expect(error.code).toBe('NOT_FOUND')
    expect(error.details).toEqual({ detail: 'extra info' })
  })

  it('creates error with minimal properties', () => {
    const error = new ApiClientError('Minimal error')

    expect(error.name).toBe('ApiClientError')
    expect(error.message).toBe('Minimal error')
    expect(error.status).toBeUndefined()
    expect(error.code).toBeUndefined()
    expect(error.details).toBeUndefined()
  })
})
