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
import { getCurrentUser } from '@/api/endpoints/users'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock the env module
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

describe('getCurrentUser', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches current user successfully', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      is_superuser: false,
      is_active: true,
      is_verified: true,
    }

    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.json(mockUser)
      }),
    )

    const result = await getCurrentUser()
    expect(result.id).toBe('user-123')
    expect(result.email).toBe('test@example.com')
  })

  it('throws error for invalid response schema', async () => {
    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.json({ invalid: 'data' })
      }),
    )

    await expect(getCurrentUser()).rejects.toThrow()
  })

  it('throws error for unauthorized access', async () => {
    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      }),
    )

    await expect(getCurrentUser()).rejects.toThrow()
  })

  it('throws error for network failures', async () => {
    worker.use(
      http.get(API_ENDPOINTS.users.me, () => {
        return HttpResponse.error()
      }),
    )

    await expect(getCurrentUser()).rejects.toThrow()
  })
})
