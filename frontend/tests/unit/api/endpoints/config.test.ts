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
import { worker } from '@tests/../mocks/browser'
import {
  fetchConfigFromAPI,
  initializeConfig,
  refreshConfig,
} from '@/api/endpoints/config'
import { API_ENDPOINTS } from '@/api/endpoints'
import { useConfigStore } from '@/stores/configStore'

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

const mockConfig = {
  language_iso639_1: 'en',
  authType: 'anonymous' as const,
  loginEndpoint: null,
}

describe('fetchConfigFromAPI', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches config from API successfully', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json(mockConfig)
      }),
    )

    const result = await fetchConfigFromAPI()
    expect(result.language_iso639_1).toBe('en')
    expect(result.authType).toBe('anonymous')
  })

  it('throws error for non-200 responses', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 })
      }),
    )

    await expect(fetchConfigFromAPI()).rejects.toThrow(
      'Config API returned 500',
    )
  })

  it('throws error for invalid authType', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        // Invalid authType should fail validation
        return HttpResponse.json({
          language_iso639_1: 'en',
          authType: 'invalid-type',
        })
      }),
    )

    await expect(fetchConfigFromAPI()).rejects.toThrow()
  })

  it('throws error on network failure', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.error()
      }),
    )

    await expect(fetchConfigFromAPI()).rejects.toThrow()
  })
})

describe('initializeConfig', () => {
  beforeEach(() => {
    // Reset the store before each test
    useConfigStore.setState({
      config: null,
      isLoading: false,
      error: null,
      source: null,
    })
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('loads config from API when no cache exists', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json(mockConfig)
      }),
    )

    await initializeConfig()

    const state = useConfigStore.getState()
    expect(state.config).toEqual(mockConfig)
    expect(state.source).toBe('api')
  })

  it('uses cached config when available', async () => {
    const cachedConfig = { ...mockConfig, language_iso639_1: 'de' }

    // Set cached config in store
    useConfigStore.setState({
      config: cachedConfig,
      source: 'cache',
    })

    // Set up handler for potential background refresh
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json(mockConfig)
      }),
    )

    await initializeConfig()

    const state = useConfigStore.getState()
    expect(state.config?.language_iso639_1).toBe('de')
    // API may be called for background refresh, but initial config should be from cache
    expect(state.source).toBe('cache')
  })

  it('sets error state on fetch failure', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json({ message: 'Error' }, { status: 500 })
      }),
    )

    await expect(initializeConfig()).rejects.toThrow()

    const state = useConfigStore.getState()
    expect(state.error).not.toBeNull()
  })
})

describe('refreshConfig', () => {
  beforeEach(() => {
    // Reset the store with existing config
    useConfigStore.setState({
      config: mockConfig,
      isLoading: false,
      error: null,
      source: 'cache',
    })
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('refreshes config from API', async () => {
    const newConfig = { ...mockConfig, language_iso639_1: 'fr' }

    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json(newConfig)
      }),
    )

    await refreshConfig()

    const state = useConfigStore.getState()
    expect(state.config?.language_iso639_1).toBe('fr')
    expect(state.source).toBe('api')
  })

  it('clears loading state after refresh completes', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json(mockConfig)
      }),
    )

    await refreshConfig()

    const finalState = useConfigStore.getState()
    expect(finalState.isLoading).toBe(false)
  })

  it('sets error state on refresh failure', async () => {
    worker.use(
      http.get(API_ENDPOINTS.admin.uiConfig, () => {
        return HttpResponse.json({ message: 'Error' }, { status: 500 })
      }),
    )

    await expect(refreshConfig()).rejects.toThrow()

    const state = useConfigStore.getState()
    expect(state.error).not.toBeNull()
  })
})
