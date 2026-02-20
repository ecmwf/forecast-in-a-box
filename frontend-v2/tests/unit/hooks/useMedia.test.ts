/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMedia } from '@/hooks/useMedia'

describe('useMedia', () => {
  // Store the original matchMedia
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    // Restore original matchMedia
    window.matchMedia = originalMatchMedia
  })

  it('returns initial match state', () => {
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 768px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    window.matchMedia = mockMatchMedia

    const { result } = renderHook(() => useMedia('(min-width: 768px)'))

    expect(result.current).toBe(true)
    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 768px)')
  })

  it('returns false when query does not match', () => {
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    window.matchMedia = mockMatchMedia

    const { result } = renderHook(() => useMedia('(min-width: 1200px)'))

    expect(result.current).toBe(false)
  })

  it('updates when media query changes', () => {
    let changeHandler: (() => void) | null = null
    let matches = false

    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return matches
      },
      media: query,
      addEventListener: vi.fn((_: string, handler: () => void) => {
        changeHandler = handler
      }),
      removeEventListener: vi.fn(),
    }))
    window.matchMedia = mockMatchMedia

    const { result } = renderHook(() => useMedia('(min-width: 768px)'))

    expect(result.current).toBe(false)

    // Simulate media query change
    matches = true
    act(() => {
      changeHandler?.()
    })

    expect(result.current).toBe(true)
  })

  it('cleans up event listener on unmount', () => {
    const removeEventListener = vi.fn()
    const addEventListener = vi.fn()

    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener,
      removeEventListener,
    }))
    window.matchMedia = mockMatchMedia

    const { unmount } = renderHook(() => useMedia('(min-width: 768px)'))

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    )
  })

  it('re-subscribes when query changes', () => {
    const removeEventListener = vi.fn()
    const addEventListener = vi.fn()

    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('768'),
      media: query,
      addEventListener,
      removeEventListener,
    }))
    window.matchMedia = mockMatchMedia

    const { rerender } = renderHook(({ query }) => useMedia(query), {
      initialProps: { query: '(min-width: 768px)' },
    })

    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 768px)')

    rerender({ query: '(min-width: 1024px)' })

    expect(mockMatchMedia).toHaveBeenCalledWith('(min-width: 1024px)')
    expect(removeEventListener).toHaveBeenCalled()
  })

  it('handles common media queries', () => {
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    window.matchMedia = mockMatchMedia

    const { result: darkMode } = renderHook(() =>
      useMedia('(prefers-color-scheme: dark)'),
    )
    expect(darkMode.current).toBe(true)

    const { result: reducedMotion } = renderHook(() =>
      useMedia('(prefers-reduced-motion: reduce)'),
    )
    expect(reducedMotion.current).toBe(false)
  })
})
