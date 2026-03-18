/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  getMockAuthenticatedConfig,
  getMockConfig,
} from '@tests/utils/factories'
import {
  useAuthType,
  useConfig,
  useConfigError,
  useConfigSource,
  useIsConfigLoading,
  useIsConfigReady,
  useLanguage,
  useLoginEndpoint,
} from '@/hooks/useConfig'
import { useConfigStore } from '@/stores/configStore'

describe('useConfig hooks', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useConfigStore.getState().resetConfig()
    })
  })

  describe('useConfig', () => {
    it('returns null when config is not loaded', () => {
      const { result } = renderHook(() => useConfig())
      expect(result.current).toBeNull()
    })

    it('returns config when loaded', () => {
      const mockConfig = getMockConfig()

      act(() => {
        useConfigStore.getState().setConfig(mockConfig, 'api')
      })

      const { result } = renderHook(() => useConfig())
      expect(result.current).toEqual(mockConfig)
    })

    it('updates when config changes', () => {
      const { result } = renderHook(() => useConfig())

      expect(result.current).toBeNull()

      act(() => {
        useConfigStore.getState().setConfig(getMockConfig(), 'api')
      })

      expect(result.current).not.toBeNull()
    })
  })

  describe('useLanguage', () => {
    it('returns default "en" when config is not loaded', () => {
      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('en')
    })

    it('returns configured language', () => {
      act(() => {
        useConfigStore
          .getState()
          .setConfig(getMockConfig({ language_iso639_1: 'de' }), 'api')
      })

      const { result } = renderHook(() => useLanguage())
      expect(result.current).toBe('de')
    })
  })

  describe('useAuthType', () => {
    it('returns default "anonymous" when config is not loaded', () => {
      const { result } = renderHook(() => useAuthType())
      expect(result.current).toBe('anonymous')
    })

    it('returns "authenticated" when configured', () => {
      act(() => {
        useConfigStore.getState().setConfig(getMockAuthenticatedConfig(), 'api')
      })

      const { result } = renderHook(() => useAuthType())
      expect(result.current).toBe('authenticated')
    })
  })

  describe('useLoginEndpoint', () => {
    it('returns null when config is not loaded', () => {
      const { result } = renderHook(() => useLoginEndpoint())
      expect(result.current).toBeNull()
    })

    it('returns null for anonymous auth type', () => {
      act(() => {
        useConfigStore.getState().setConfig(getMockConfig(), 'api')
      })

      const { result } = renderHook(() => useLoginEndpoint())
      expect(result.current).toBeNull()
    })

    it('returns login endpoint for authenticated mode', () => {
      act(() => {
        useConfigStore
          .getState()
          .setConfig(
            getMockAuthenticatedConfig({ loginEndpoint: '/custom/login' }),
            'api',
          )
      })

      const { result } = renderHook(() => useLoginEndpoint())
      expect(result.current).toBe('/custom/login')
    })
  })

  describe('useIsConfigReady', () => {
    it('returns false when config is not loaded', () => {
      const { result } = renderHook(() => useIsConfigReady())
      expect(result.current).toBe(false)
    })

    it('returns false while loading', () => {
      act(() => {
        useConfigStore.getState().setLoading(true)
      })

      const { result } = renderHook(() => useIsConfigReady())
      expect(result.current).toBe(false)
    })

    it('returns true when loaded and not loading', () => {
      act(() => {
        useConfigStore.getState().setConfig(getMockConfig(), 'api')
      })

      const { result } = renderHook(() => useIsConfigReady())
      expect(result.current).toBe(true)
    })
  })

  describe('useIsConfigLoading', () => {
    it('returns false initially', () => {
      const { result } = renderHook(() => useIsConfigLoading())
      expect(result.current).toBe(false)
    })

    it('returns true when loading', () => {
      act(() => {
        useConfigStore.getState().setLoading(true)
      })

      const { result } = renderHook(() => useIsConfigLoading())
      expect(result.current).toBe(true)
    })
  })

  describe('useConfigError', () => {
    it('returns null initially', () => {
      const { result } = renderHook(() => useConfigError())
      expect(result.current).toBeNull()
    })

    it('returns error when set', () => {
      const error = new Error('Config load failed')

      act(() => {
        useConfigStore.getState().setError(error)
      })

      const { result } = renderHook(() => useConfigError())
      expect(result.current).toBe(error)
    })
  })

  describe('useConfigSource', () => {
    it('returns null initially', () => {
      const { result } = renderHook(() => useConfigSource())
      expect(result.current).toBeNull()
    })

    it('returns "api" when loaded from API', () => {
      act(() => {
        useConfigStore.getState().setConfig(getMockConfig(), 'api')
      })

      const { result } = renderHook(() => useConfigSource())
      expect(result.current).toBe('api')
    })

    it('returns "cache" when loaded from cache', () => {
      act(() => {
        useConfigStore.getState().setConfig(getMockConfig(), 'cache')
      })

      const { result } = renderHook(() => useConfigSource())
      expect(result.current).toBe('cache')
    })
  })
})
