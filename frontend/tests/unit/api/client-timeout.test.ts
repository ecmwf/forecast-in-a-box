/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, delay, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/../mocks/browser'
import { ApiClientError, apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
// Initialise i18next so the message resolves to a real string.
import '@/lib/i18n'

vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

describe('apiClient timeout', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('aborts a stalled request instead of pending forever', async () => {
    // A backend queued behind a busy pool answers nothing at all.
    worker.use(
      http.get(API_ENDPOINTS.status, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )

    const error = await apiClient
      .get(API_ENDPOINTS.status, { timeout: 120 })
      .then(() => null)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).code).toBe('TIMEOUT_ERROR')
    // Distinguishable from an unreachable server, and it names the budget.
    expect((error as ApiClientError).message).toMatch(/did not respond/)
  })

  it('leaves a response that arrives inside the budget alone', async () => {
    worker.use(
      http.get(API_ENDPOINTS.status, async () => {
        await delay(10)
        return HttpResponse.json({ api: 'up' })
      }),
    )

    await expect(
      apiClient.get(API_ENDPOINTS.status, { timeout: 3000 }),
    ).resolves.toEqual({ api: 'up' })
  })
})
