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
import { useEventSource } from '@/hooks/useEventSource'

/**
 * Mock EventSource instances tracked for testing
 */
let mockEventSourceInstances: Array<MockEventSource> = []

/**
 * Mock EventSource class for testing
 */
class MockEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  url: string
  readyState: number = MockEventSource.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  private listeners: Map<string, Array<EventListener>> = new Map()

  constructor(url: string) {
    this.url = url
    mockEventSourceInstances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    const existing = this.listeners.get(type) || []
    this.listeners.set(type, [...existing, listener])
  }

  removeEventListener(type: string, listener: EventListener) {
    const existing = this.listeners.get(type) || []
    this.listeners.set(
      type,
      existing.filter((l) => l !== listener),
    )
  }

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED
  })

  // Test helper methods
  simulateOpen() {
    this.readyState = MockEventSource.OPEN
    const event = new Event('open')
    this.onopen?.(event)
  }

  simulateMessage(data: unknown) {
    const event = new MessageEvent('message', {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })
    this.onmessage?.(event)
  }

  simulateCustomEvent(type: string, data: unknown) {
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })
    const listeners = this.listeners.get(type) || []
    listeners.forEach((listener) => listener(event))
  }

  simulateError() {
    this.readyState = MockEventSource.CLOSED
    const event = new Event('error')
    this.onerror?.(event)
  }
}

// Store original EventSource for restoration
const OriginalEventSource = globalThis.EventSource

describe('useEventSource', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockEventSourceInstances = []

    // Replace EventSource with mock class
    // @ts-expect-error - replacing global with mock
    globalThis.EventSource = MockEventSource
  })

  afterEach(() => {
    vi.useRealTimers()
    // Restore original EventSource
    globalThis.EventSource = OriginalEventSource
  })

  describe('connection lifecycle', () => {
    it('creates EventSource when enabled', () => {
      renderHook(() => useEventSource('/api/events', { enabled: true }))

      expect(mockEventSourceInstances).toHaveLength(1)
      expect(mockEventSourceInstances[0].url).toBe('/api/events')
    })

    it('does not create EventSource when disabled', () => {
      renderHook(() => useEventSource('/api/events', { enabled: false }))

      expect(mockEventSourceInstances).toHaveLength(0)
    })

    it('returns CLOSED readyState initially', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: false }),
      )

      expect(result.current.readyState).toBe(EventSource.CLOSED)
    })

    it('updates readyState when connection opens', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateOpen()
      })

      expect(result.current.readyState).toBe(MockEventSource.OPEN)
    })

    it('closes connection on unmount', () => {
      const { unmount } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      const instance = mockEventSourceInstances[0]

      unmount()

      expect(instance.close).toHaveBeenCalled()
    })
  })

  describe('message handling', () => {
    it('parses JSON messages and updates data', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateOpen()
        mockEventSourceInstances[0].simulateMessage({ count: 42 })
      })

      expect(result.current.data).toEqual({ count: 42 })
    })

    it('handles plain string messages', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateOpen()
        mockEventSourceInstances[0].simulateMessage('plain text')
      })

      expect(result.current.data).toBe('plain text')
    })

    it('calls onMessage handler', () => {
      const onMessage = vi.fn()

      renderHook(() =>
        useEventSource('/api/events', { enabled: true, onMessage }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateOpen()
        mockEventSourceInstances[0].simulateMessage({ test: true })
      })

      expect(onMessage).toHaveBeenCalled()
    })

    it('handles custom event types', () => {
      const progressHandler = vi.fn()

      renderHook(() =>
        useEventSource('/api/events', {
          enabled: true,
          events: { progress: progressHandler },
        }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateOpen()
        mockEventSourceInstances[0].simulateCustomEvent('progress', {
          value: 50,
        })
      })

      expect(progressHandler).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('sets error state on error', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateError()
      })

      expect(result.current.error).not.toBeNull()
    })

    it('calls onError handler', () => {
      const onError = vi.fn()

      renderHook(() =>
        useEventSource('/api/events', { enabled: true, onError }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateError()
      })

      expect(onError).toHaveBeenCalled()
    })

    it('clears error on successful reconnection', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateError()
      })

      expect(result.current.error).not.toBeNull()

      // Wait for reconnection
      act(() => {
        vi.advanceTimersByTime(3000)
      })

      // Simulate successful reconnection
      act(() => {
        mockEventSourceInstances[1]?.simulateOpen()
      })

      expect(result.current.error).toBeNull()
    })
  })

  describe('reconnection', () => {
    it('attempts reconnection after error', () => {
      renderHook(() =>
        useEventSource('/api/events', {
          enabled: true,
          reconnectDelay: 3000,
        }),
      )

      act(() => {
        mockEventSourceInstances[0].simulateError()
      })

      expect(mockEventSourceInstances).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(3000)
      })

      expect(mockEventSourceInstances).toHaveLength(2)
    })

    it('respects maxReconnectAttempts', () => {
      renderHook(() =>
        useEventSource('/api/events', {
          enabled: true,
          reconnectDelay: 1000,
          maxReconnectAttempts: 2,
        }),
      )

      // First connection
      expect(mockEventSourceInstances).toHaveLength(1)

      // First error -> first reconnect attempt
      act(() => {
        mockEventSourceInstances[0].simulateError()
        vi.advanceTimersByTime(1000)
      })
      expect(mockEventSourceInstances).toHaveLength(2)

      // Second error -> second reconnect attempt
      act(() => {
        mockEventSourceInstances[1].simulateError()
        vi.advanceTimersByTime(1000)
      })
      expect(mockEventSourceInstances).toHaveLength(3)

      // Third error -> no more reconnects (max reached)
      act(() => {
        mockEventSourceInstances[2].simulateError()
        vi.advanceTimersByTime(1000)
      })
      expect(mockEventSourceInstances).toHaveLength(3)
    })

    it('resets reconnect attempts on successful open', () => {
      renderHook(() =>
        useEventSource('/api/events', {
          enabled: true,
          reconnectDelay: 1000,
          maxReconnectAttempts: 2,
        }),
      )

      // First error -> reconnect
      act(() => {
        mockEventSourceInstances[0].simulateError()
        vi.advanceTimersByTime(1000)
      })

      // Successful reconnection
      act(() => {
        mockEventSourceInstances[1].simulateOpen()
      })

      // Another error -> should start fresh reconnect attempts
      act(() => {
        mockEventSourceInstances[1].simulateError()
        vi.advanceTimersByTime(1000)
      })

      // Should create new instance (attempts reset)
      expect(mockEventSourceInstances).toHaveLength(3)
    })
  })

  describe('manual controls', () => {
    it('close() closes the connection', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      const instance = mockEventSourceInstances[0]

      act(() => {
        result.current.close()
      })

      expect(instance.close).toHaveBeenCalled()
      expect(result.current.readyState).toBe(MockEventSource.CLOSED)
    })

    it('reconnect() resets attempts and reconnects', () => {
      const { result } = renderHook(() =>
        useEventSource('/api/events', { enabled: true }),
      )

      expect(mockEventSourceInstances).toHaveLength(1)

      act(() => {
        result.current.reconnect()
      })

      expect(mockEventSourceInstances).toHaveLength(2)
    })
  })

  describe('URL and enabled changes', () => {
    it('reconnects when URL changes', () => {
      const { rerender } = renderHook(
        ({ url }) => useEventSource(url, { enabled: true }),
        { initialProps: { url: '/api/events/1' } },
      )

      expect(mockEventSourceInstances).toHaveLength(1)
      expect(mockEventSourceInstances[0].url).toBe('/api/events/1')

      rerender({ url: '/api/events/2' })

      expect(mockEventSourceInstances).toHaveLength(2)
      expect(mockEventSourceInstances[1].url).toBe('/api/events/2')
    })

    it('disconnects when enabled becomes false', () => {
      const { rerender } = renderHook(
        ({ enabled }) => useEventSource('/api/events', { enabled }),
        { initialProps: { enabled: true } },
      )

      const instance = mockEventSourceInstances[0]

      rerender({ enabled: false })

      expect(instance.close).toHaveBeenCalled()
    })
  })
})
