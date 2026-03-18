/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import type { AppConfig } from '@/types/config.types'
import {
  selectAuthType,
  selectIsConfigReady,
  selectLanguage,
  selectLoginEndpoint,
  useConfigStore,
} from '@/stores/configStore'

// Mock the config endpoint module for loadConfig tests
vi.mock('@/api/endpoints/config', () => ({
  initializeConfig: vi.fn(),
}))

const mockConfig: AppConfig = {
  language_iso639_1: 'de',
  authType: 'authenticated',
  loginEndpoint: '/auth/login',
}

describe('useConfigStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useConfigStore.getState().resetConfig()
    })
  })

  describe('initial state', () => {
    it('has null config initially', () => {
      const state = useConfigStore.getState()
      expect(state.config).toBeNull()
    })

    it('is not loading initially', () => {
      const state = useConfigStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('is not loaded initially', () => {
      const state = useConfigStore.getState()
      expect(state.isLoaded).toBe(false)
    })

    it('has no error initially', () => {
      const state = useConfigStore.getState()
      expect(state.error).toBeNull()
    })

    it('has null source initially', () => {
      const state = useConfigStore.getState()
      expect(state.source).toBeNull()
    })

    it('has null lastLoaded initially', () => {
      const state = useConfigStore.getState()
      expect(state.lastLoaded).toBeNull()
    })
  })

  describe('setConfig', () => {
    it('sets config with source', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const state = useConfigStore.getState()
      expect(state.config).toEqual(mockConfig)
      expect(state.source).toBe('api')
    })

    it('sets isLoaded to true', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'cache')
      })

      expect(useConfigStore.getState().isLoaded).toBe(true)
    })

    it('sets isLoading to false', () => {
      act(() => {
        useConfigStore.getState().setLoading(true)
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      expect(useConfigStore.getState().isLoading).toBe(false)
    })

    it('clears error', () => {
      act(() => {
        useConfigStore.getState().setError(new Error('previous error'))
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      expect(useConfigStore.getState().error).toBeNull()
    })

    it('sets lastLoaded timestamp', () => {
      const before = Date.now()

      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const after = Date.now()
      const lastLoaded = useConfigStore.getState().lastLoaded

      expect(lastLoaded).toBeGreaterThanOrEqual(before)
      expect(lastLoaded).toBeLessThanOrEqual(after)
    })
  })

  describe('resetConfig', () => {
    it('resets to initial state', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
        useConfigStore.getState().resetConfig()
      })

      const state = useConfigStore.getState()
      expect(state.config).toBeNull()
      expect(state.isLoaded).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(state.source).toBeNull()
      expect(state.lastLoaded).toBeNull()
    })
  })

  describe('setLoading', () => {
    it('sets loading to true', () => {
      act(() => {
        useConfigStore.getState().setLoading(true)
      })

      expect(useConfigStore.getState().isLoading).toBe(true)
    })

    it('sets loading to false', () => {
      act(() => {
        useConfigStore.getState().setLoading(true)
        useConfigStore.getState().setLoading(false)
      })

      expect(useConfigStore.getState().isLoading).toBe(false)
    })
  })

  describe('setError', () => {
    it('sets error and clears loading', () => {
      const error = new Error('test error')

      act(() => {
        useConfigStore.getState().setLoading(true)
        useConfigStore.getState().setError(error)
      })

      const state = useConfigStore.getState()
      expect(state.error).toBe(error)
      expect(state.isLoading).toBe(false)
    })

    it('can clear error by setting null', () => {
      act(() => {
        useConfigStore.getState().setError(new Error('error'))
        useConfigStore.getState().setError(null)
      })

      expect(useConfigStore.getState().error).toBeNull()
    })
  })

  describe('loadConfig', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('clears error before loading', async () => {
      const { initializeConfig } = await import('@/api/endpoints/config')
      vi.mocked(initializeConfig).mockResolvedValue(undefined)

      act(() => {
        useConfigStore.getState().setError(new Error('previous'))
      })

      await useConfigStore.getState().loadConfig()

      expect(useConfigStore.getState().error).toBeNull()
    })

    it('sets error on load failure', async () => {
      const { initializeConfig } = await import('@/api/endpoints/config')
      const testError = new Error('load failed')
      vi.mocked(initializeConfig).mockRejectedValue(testError)

      try {
        await useConfigStore.getState().loadConfig()
      } catch {
        // Expected to throw
      }

      const state = useConfigStore.getState()
      expect(state.error?.message).toBe('load failed')
      expect(state.isLoading).toBe(false)
    })

    it('re-throws error after setting it', async () => {
      const { initializeConfig } = await import('@/api/endpoints/config')
      vi.mocked(initializeConfig).mockRejectedValue(new Error('test error'))

      await expect(useConfigStore.getState().loadConfig()).rejects.toThrow(
        'test error',
      )
    })

    it('handles non-Error rejections', async () => {
      const { initializeConfig } = await import('@/api/endpoints/config')
      vi.mocked(initializeConfig).mockRejectedValue('string error')

      try {
        await useConfigStore.getState().loadConfig()
      } catch {
        // Expected to throw
      }

      const state = useConfigStore.getState()
      expect(state.error?.message).toBe('string error')
    })
  })
})

describe('selectors', () => {
  beforeEach(() => {
    act(() => {
      useConfigStore.getState().resetConfig()
    })
  })

  describe('selectLanguage', () => {
    it('returns default "en" when config is null', () => {
      const state = useConfigStore.getState()
      expect(selectLanguage(state)).toBe('en')
    })

    it('returns configured language', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const state = useConfigStore.getState()
      expect(selectLanguage(state)).toBe('de')
    })
  })

  describe('selectAuthType', () => {
    it('returns default "anonymous" when config is null', () => {
      const state = useConfigStore.getState()
      expect(selectAuthType(state)).toBe('anonymous')
    })

    it('returns configured auth type', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const state = useConfigStore.getState()
      expect(selectAuthType(state)).toBe('authenticated')
    })
  })

  describe('selectLoginEndpoint', () => {
    it('returns null when config is null', () => {
      const state = useConfigStore.getState()
      expect(selectLoginEndpoint(state)).toBeNull()
    })

    it('returns configured login endpoint', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const state = useConfigStore.getState()
      expect(selectLoginEndpoint(state)).toBe('/auth/login')
    })
  })

  describe('selectIsConfigReady', () => {
    it('returns false when config is null', () => {
      const state = useConfigStore.getState()
      expect(selectIsConfigReady(state)).toBe(false)
    })

    it('returns false when loading', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
        useConfigStore.getState().setLoading(true)
      })

      const state = useConfigStore.getState()
      expect(selectIsConfigReady(state)).toBe(false)
    })

    it('returns true when loaded and not loading', () => {
      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const state = useConfigStore.getState()
      expect(selectIsConfigReady(state)).toBe(true)
    })
  })
})
