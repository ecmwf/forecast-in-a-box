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
import { toast } from 'sonner'
import { showToast } from '@/lib/toast'

// Mock sonner
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

describe('showToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('success', () => {
    it('calls toast.success with message', () => {
      showToast.success('Operation completed')
      expect(toast.success).toHaveBeenCalledWith('Operation completed', {
        description: undefined,
      })
    })

    it('calls toast.success with message and description', () => {
      showToast.success('Saved', 'Your changes have been saved')
      expect(toast.success).toHaveBeenCalledWith('Saved', {
        description: 'Your changes have been saved',
      })
    })
  })

  describe('error', () => {
    it('calls toast.error with message', () => {
      showToast.error('Something went wrong')
      expect(toast.error).toHaveBeenCalledWith('Something went wrong', {
        description: undefined,
      })
    })

    it('calls toast.error with message and description', () => {
      showToast.error('Error', 'Please try again')
      expect(toast.error).toHaveBeenCalledWith('Error', {
        description: 'Please try again',
      })
    })
  })

  describe('warning', () => {
    it('calls toast.warning with message', () => {
      showToast.warning('Be careful')
      expect(toast.warning).toHaveBeenCalledWith('Be careful', {
        description: undefined,
      })
    })
  })

  describe('info', () => {
    it('calls toast.info with message', () => {
      showToast.info('Did you know?')
      expect(toast.info).toHaveBeenCalledWith('Did you know?', {
        description: undefined,
      })
    })
  })

  describe('apiError', () => {
    it('shows error with message from Error object', () => {
      const error = new Error('Network request failed')
      showToast.apiError(error)
      expect(toast.error).toHaveBeenCalledWith('Network request failed')
    })

    it('shows default message when error has no message', () => {
      const error = new Error()
      showToast.apiError(error)
      expect(toast.error).toHaveBeenCalledWith('An error occurred')
    })

    it('includes retry action when provided', () => {
      const error = new Error('Failed')
      const retry = vi.fn()
      showToast.apiError(error, { retry })

      expect(toast.error).toHaveBeenCalledWith('Failed', {
        action: {
          label: 'Retry',
          onClick: retry,
        },
      })
    })
  })

  describe('loading', () => {
    it('calls toast.loading with message', () => {
      showToast.loading('Processing...')
      expect(toast.loading).toHaveBeenCalledWith('Processing...')
    })
  })

  describe('dismiss', () => {
    it('calls toast.dismiss with toast ID', () => {
      showToast.dismiss('toast-123')
      expect(toast.dismiss).toHaveBeenCalledWith('toast-123')
    })

    it('calls toast.dismiss without ID to dismiss all', () => {
      showToast.dismiss()
      expect(toast.dismiss).toHaveBeenCalledWith(undefined)
    })
  })

  describe('promise', () => {
    it('calls toast.promise with promise and messages', () => {
      const promise = Promise.resolve('result')
      const messages = {
        loading: 'Loading...',
        success: 'Done!',
        error: 'Failed',
      }

      showToast.promise(promise, messages)
      expect(toast.promise).toHaveBeenCalledWith(promise, messages)
    })
  })
})
