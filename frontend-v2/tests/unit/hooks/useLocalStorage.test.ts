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
import { act, renderHook } from '@testing-library/react'
import { useLocalStorage } from '@/hooks/useLocalStorage'

// Mock logger to suppress expected error output in tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('returns initial value when key does not exist', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'default'),
      )

      expect(result.current[0]).toBe('default')
    })

    it('returns stored value when key exists', () => {
      localStorage.setItem('test-key', JSON.stringify('stored-value'))

      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'default'),
      )

      expect(result.current[0]).toBe('stored-value')
    })

    it('returns initial value on JSON parse error', () => {
      localStorage.setItem('test-key', 'invalid-json')

      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'default'),
      )

      expect(result.current[0]).toBe('default')
    })
  })

  describe('setValue', () => {
    it('updates state and localStorage', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'initial'),
      )

      act(() => {
        result.current[1]('updated')
      })

      expect(result.current[0]).toBe('updated')
      expect(JSON.parse(localStorage.getItem('test-key')!)).toBe('updated')
    })

    it('accepts function updater', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', { count: 0 }),
      )

      act(() => {
        result.current[1]((prev) => ({ count: prev.count + 1 }))
      })

      expect(result.current[0]).toEqual({ count: 1 })
    })

    it('handles objects correctly', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', { name: 'test' }),
      )

      act(() => {
        result.current[1]({ name: 'updated' })
      })

      expect(result.current[0]).toEqual({ name: 'updated' })
      expect(JSON.parse(localStorage.getItem('test-key')!)).toEqual({
        name: 'updated',
      })
    })

    it('handles arrays correctly', () => {
      const { result } = renderHook(() =>
        useLocalStorage<Array<string>>('test-key', []),
      )

      act(() => {
        result.current[1](['a', 'b', 'c'])
      })

      expect(result.current[0]).toEqual(['a', 'b', 'c'])
    })
  })

  describe('cross-tab synchronization', () => {
    it('updates state when storage event fires', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'initial'),
      )

      act(() => {
        // Simulate storage event from another tab
        const event = new StorageEvent('storage', {
          key: 'test-key',
          newValue: JSON.stringify('from-other-tab'),
        })
        window.dispatchEvent(event)
      })

      expect(result.current[0]).toBe('from-other-tab')
    })

    it('ignores storage events for different keys', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'initial'),
      )

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'other-key',
          newValue: JSON.stringify('should-not-update'),
        })
        window.dispatchEvent(event)
      })

      expect(result.current[0]).toBe('initial')
    })

    it('ignores storage events with null newValue', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'initial'),
      )

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'test-key',
          newValue: null,
        })
        window.dispatchEvent(event)
      })

      expect(result.current[0]).toBe('initial')
    })

    it('handles invalid JSON in storage event', () => {
      const { result } = renderHook(() =>
        useLocalStorage('test-key', 'initial'),
      )

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'test-key',
          newValue: 'not-valid-json',
        })
        window.dispatchEvent(event)
      })

      // Should keep current value on parse error
      expect(result.current[0]).toBe('initial')
    })

    it('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useLocalStorage('test-key', 'initial'),
      )

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'storage',
        expect.any(Function),
      )
    })
  })

  describe('type safety', () => {
    it('preserves number types', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 42))

      expect(typeof result.current[0]).toBe('number')
      expect(result.current[0]).toBe(42)

      act(() => {
        result.current[1](100)
      })

      expect(typeof result.current[0]).toBe('number')
      expect(result.current[0]).toBe(100)
    })

    it('preserves boolean types', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', true))

      expect(typeof result.current[0]).toBe('boolean')

      act(() => {
        result.current[1](false)
      })

      expect(result.current[0]).toBe(false)
    })

    it('preserves null values', () => {
      const { result } = renderHook(() =>
        useLocalStorage<string | null>('test-key', null),
      )

      expect(result.current[0]).toBeNull()

      act(() => {
        result.current[1]('value')
      })

      expect(result.current[0]).toBe('value')

      act(() => {
        result.current[1](null)
      })

      expect(result.current[0]).toBeNull()
    })
  })
})
