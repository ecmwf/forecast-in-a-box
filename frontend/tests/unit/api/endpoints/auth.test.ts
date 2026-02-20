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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/../mocks/browser'
import { checkSession, getAuthorizationUrl, logout } from '@/api/endpoints/auth'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock the env module
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('checkSession', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('returns true when session is valid', async () => {
    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.json({ id: 'user-123', username: 'test' })
      }),
    )

    const result = await checkSession()
    expect(result).toBe(true)
  })

  it('returns false when session is invalid (401)', async () => {
    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      }),
    )

    const result = await checkSession()
    expect(result).toBe(false)
  })

  it('returns false on network error', async () => {
    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.error()
      }),
    )

    const result = await checkSession()
    expect(result).toBe(false)
  })
})

describe('getAuthorizationUrl', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('returns authorization URL from backend', async () => {
    const authUrl = 'https://auth.example.com/authorize?client_id=test'

    worker.use(
      http.get('/api/v1/auth/oidc/authorize', () => {
        return HttpResponse.json({ authorization_url: authUrl })
      }),
    )

    const result = await getAuthorizationUrl('/api/v1/auth/oidc/authorize')
    expect(result).toBe(authUrl)
  })

  it('normalizes endpoint without /api prefix', async () => {
    const authUrl = 'https://auth.example.com/authorize'

    worker.use(
      http.get('/api/v1/auth/login', () => {
        return HttpResponse.json({ authorization_url: authUrl })
      }),
    )

    const result = await getAuthorizationUrl('/v1/auth/login')
    expect(result).toBe(authUrl)
  })

  it('throws error when response is not ok', async () => {
    worker.use(
      http.get('/api/v1/auth/oidc/authorize', () => {
        return HttpResponse.json({ message: 'Not found' }, { status: 404 })
      }),
    )

    await expect(
      getAuthorizationUrl('/api/v1/auth/oidc/authorize'),
    ).rejects.toThrow('Failed to get authorization URL')
  })

  it('throws error when authorization_url is missing', async () => {
    worker.use(
      http.get('/api/v1/auth/oidc/authorize', () => {
        return HttpResponse.json({ other: 'data' })
      }),
    )

    await expect(
      getAuthorizationUrl('/api/v1/auth/oidc/authorize'),
    ).rejects.toThrow('No authorization_url in response')
  })

  it('throws error on network failure', async () => {
    worker.use(
      http.get('/api/v1/auth/oidc/authorize', () => {
        return HttpResponse.error()
      }),
    )

    await expect(
      getAuthorizationUrl('/api/v1/auth/oidc/authorize'),
    ).rejects.toThrow()
  })
})

describe('logout', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('returns true on successful logout', async () => {
    worker.use(
      http.post(API_ENDPOINTS.auth.logout, () => {
        return HttpResponse.json({ success: true })
      }),
    )

    const result = await logout()
    expect(result).toBe(true)
  })

  it('returns false on non-200 response', async () => {
    worker.use(
      http.post(API_ENDPOINTS.auth.logout, () => {
        return HttpResponse.json({ message: 'Error' }, { status: 400 })
      }),
    )

    const result = await logout()
    expect(result).toBe(false)
  })

  it('returns false on network error', async () => {
    worker.use(
      http.post(API_ENDPOINTS.auth.logout, () => {
        return HttpResponse.error()
      }),
    )

    const result = await logout()
    expect(result).toBe(false)
  })
})
