/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLanguageSync } from '@/hooks/useLanguageSync'

// Track mock state
let mockConfigLanguage = 'en'
let mockI18nLanguage = 'en'
const mockChangeLanguage = vi.fn()

// Mock useConfig hook
vi.mock('@/hooks/useConfig', () => ({
  useLanguage: () => mockConfigLanguage,
}))

// Mock i18n
vi.mock('@/lib/i18n', () => ({
  default: {
    get language() {
      return mockI18nLanguage
    },
    changeLanguage: (lang: string) => {
      mockI18nLanguage = lang
      return mockChangeLanguage(lang)
    },
  },
}))

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('useLanguageSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigLanguage = 'en'
    mockI18nLanguage = 'en'
    mockChangeLanguage.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('language synchronization', () => {
    it('does not change language when i18n and config are already in sync', () => {
      mockConfigLanguage = 'en'
      mockI18nLanguage = 'en'

      act(() => {
        renderHook(() => useLanguageSync())
      })

      // Should NOT call changeLanguage when already in sync
      expect(mockChangeLanguage).not.toHaveBeenCalled()
    })

    it('changes language when i18n differs from config', () => {
      mockConfigLanguage = 'de'
      mockI18nLanguage = 'en'

      act(() => {
        renderHook(() => useLanguageSync())
      })

      expect(mockChangeLanguage).toHaveBeenCalledWith('de')
    })

    it('updates i18n language to match config language', () => {
      mockConfigLanguage = 'fr'
      mockI18nLanguage = 'en'

      act(() => {
        renderHook(() => useLanguageSync())
      })

      expect(mockChangeLanguage).toHaveBeenCalledWith('fr')
    })
  })

  describe('language change scenarios', () => {
    it('syncs to German language', () => {
      mockConfigLanguage = 'de'
      mockI18nLanguage = 'en'

      act(() => {
        renderHook(() => useLanguageSync())
      })

      expect(mockChangeLanguage).toHaveBeenCalledWith('de')
    })

    it('syncs to French language', () => {
      mockConfigLanguage = 'fr'
      mockI18nLanguage = 'en'

      act(() => {
        renderHook(() => useLanguageSync())
      })

      expect(mockChangeLanguage).toHaveBeenCalledWith('fr')
    })

    it('syncs to Spanish language', () => {
      mockConfigLanguage = 'es'
      mockI18nLanguage = 'en'

      act(() => {
        renderHook(() => useLanguageSync())
      })

      expect(mockChangeLanguage).toHaveBeenCalledWith('es')
    })
  })

  describe('rerender behavior', () => {
    it('does not change language on rerender if language unchanged', () => {
      mockConfigLanguage = 'en'
      mockI18nLanguage = 'en'

      const { rerender } = renderHook(() => useLanguageSync())

      expect(mockChangeLanguage).not.toHaveBeenCalled()

      act(() => {
        rerender()
      })

      expect(mockChangeLanguage).not.toHaveBeenCalled()
    })

    it('syncs language when config language changes', () => {
      mockConfigLanguage = 'en'
      mockI18nLanguage = 'en'

      const { rerender } = renderHook(() => useLanguageSync())

      expect(mockChangeLanguage).not.toHaveBeenCalled()

      // Simulate config language changing
      mockConfigLanguage = 'de'
      mockI18nLanguage = 'en' // i18n hasn't synced yet

      act(() => {
        rerender()
      })

      expect(mockChangeLanguage).toHaveBeenCalledWith('de')
    })
  })

  describe('error handling', () => {
    it('handles language change errors gracefully', () => {
      mockConfigLanguage = 'de'
      mockI18nLanguage = 'en'
      mockChangeLanguage.mockRejectedValue(new Error('Language not available'))

      // Should not throw
      expect(() => {
        act(() => {
          renderHook(() => useLanguageSync())
        })
      }).not.toThrow()

      expect(mockChangeLanguage).toHaveBeenCalledWith('de')
    })
  })
})
