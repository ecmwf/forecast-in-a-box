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
import { toast } from 'sonner'
import { setupGlobalErrorHandlers } from '@/lib/globalErrorHandler'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  },
}))

// Mock logger to prevent console output during tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('setupGlobalErrorHandlers', () => {
  let originalOnerror: OnErrorEventHandler
  let unhandledRejectionListeners: Array<(event: PromiseRejectionEvent) => void>

  beforeEach(() => {
    vi.clearAllMocks()

    // Store original handlers
    originalOnerror = window.onerror
    unhandledRejectionListeners = []

    // Mock addEventListener to capture rejection handlers
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type, listener) => {
        if (type === 'unhandledrejection') {
          unhandledRejectionListeners.push(
            listener as (event: PromiseRejectionEvent) => void,
          )
        }
      },
    )
  })

  afterEach(() => {
    window.onerror = originalOnerror
    vi.restoreAllMocks()
  })

  describe('window.onerror handler', () => {
    it('sets up window.onerror handler', () => {
      setupGlobalErrorHandlers()

      expect(window.onerror).toBeDefined()
      expect(typeof window.onerror).toBe('function')
    })

    it('shows toast on uncaught error', () => {
      setupGlobalErrorHandlers()

      // Trigger the error handler
      const result = (
        window.onerror as (
          message: string,
          source?: string,
          lineno?: number,
          colno?: number,
          error?: Error,
        ) => boolean
      )('Test error message', 'test.js', 10, 5, new Error('Test error'))

      expect(toast.error).toHaveBeenCalledWith('An unexpected error occurred', {
        description: 'Please try refreshing the page',
      })

      // Should return false to allow default browser handling
      expect(result).toBe(false)
    })

    it('handles error without Error object', () => {
      setupGlobalErrorHandlers()

      const result = (
        window.onerror as (
          message: string,
          source?: string,
          lineno?: number,
          colno?: number,
          error?: Error,
        ) => boolean
      )('String error message', 'test.js', 10, 5, undefined)

      expect(toast.error).toHaveBeenCalled()
      expect(result).toBe(false)
    })
  })

  describe('unhandledrejection handler', () => {
    it('sets up unhandledrejection listener', () => {
      setupGlobalErrorHandlers()

      expect(window.addEventListener).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function),
      )
    })

    it('shows toast with Error message on rejection', () => {
      setupGlobalErrorHandlers()

      // Simulate unhandled rejection
      const rejectionEvent = {
        reason: new Error('Promise rejected'),
      } as PromiseRejectionEvent

      unhandledRejectionListeners.forEach((listener) =>
        listener(rejectionEvent),
      )

      // showToast.error wraps toast.error with { description: undefined }
      expect(toast.error).toHaveBeenCalledWith('Promise rejected', {
        description: undefined,
      })
    })

    it('shows toast with string reason', () => {
      setupGlobalErrorHandlers()

      const rejectionEvent = {
        reason: 'String rejection reason',
      } as PromiseRejectionEvent

      unhandledRejectionListeners.forEach((listener) =>
        listener(rejectionEvent),
      )

      expect(toast.error).toHaveBeenCalledWith('String rejection reason', {
        description: undefined,
      })
    })

    it('shows default message for non-Error, non-string reason', () => {
      setupGlobalErrorHandlers()

      const rejectionEvent = {
        reason: { code: 500 },
      } as PromiseRejectionEvent

      unhandledRejectionListeners.forEach((listener) =>
        listener(rejectionEvent),
      )

      expect(toast.error).toHaveBeenCalledWith('An unexpected error occurred', {
        description: undefined,
      })
    })

    it('handles null reason', () => {
      setupGlobalErrorHandlers()

      const rejectionEvent = {
        reason: null,
      } as PromiseRejectionEvent

      unhandledRejectionListeners.forEach((listener) =>
        listener(rejectionEvent),
      )

      expect(toast.error).toHaveBeenCalledWith('An unexpected error occurred', {
        description: undefined,
      })
    })

    it('handles undefined reason', () => {
      setupGlobalErrorHandlers()

      const rejectionEvent = {
        reason: undefined,
      } as PromiseRejectionEvent

      unhandledRejectionListeners.forEach((listener) =>
        listener(rejectionEvent),
      )

      expect(toast.error).toHaveBeenCalledWith('An unexpected error occurred', {
        description: undefined,
      })
    })
  })

  describe('handler installation', () => {
    it('can be called multiple times without throwing', () => {
      expect(() => {
        setupGlobalErrorHandlers()
        setupGlobalErrorHandlers()
      }).not.toThrow()
    })
  })
})
