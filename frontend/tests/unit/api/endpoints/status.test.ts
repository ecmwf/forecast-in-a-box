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
import { fetchStatus } from '@/api/endpoints/status'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock the env module
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

describe('fetchStatus', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches status successfully', async () => {
    const mockStatus = {
      version: '1.0.0',
      api: 'up',
      cascade: 'up',
      ecmwf: 'up',
      scheduler: 'up',
    }

    worker.use(
      http.get(API_ENDPOINTS.status, () => {
        return HttpResponse.json(mockStatus)
      }),
    )

    const result = await fetchStatus()
    expect(result.version).toBe('1.0.0')
    expect(result.api).toBe('up')
  })

  it('throws error for invalid response schema', async () => {
    worker.use(
      http.get(API_ENDPOINTS.status, () => {
        return HttpResponse.json({ invalid: 'data' })
      }),
    )

    await expect(fetchStatus()).rejects.toThrow()
  })

  it('throws error for network failures', async () => {
    worker.use(
      http.get(API_ENDPOINTS.status, () => {
        return HttpResponse.error()
      }),
    )

    await expect(fetchStatus()).rejects.toThrow()
  })

  it('throws error for non-200 responses', async () => {
    worker.use(
      http.get(API_ENDPOINTS.status, () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 })
      }),
    )

    await expect(fetchStatus()).rejects.toThrow()
  })
})
