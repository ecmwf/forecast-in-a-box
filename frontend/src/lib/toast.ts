/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { toast } from 'sonner'

/**
 * Toast notification utilities for user-facing messages.
 *
 * Usage:
 * ```ts
 * import { showToast } from '@/lib/toast'
 *
 * showToast.success('Operation completed')
 * showToast.error('Something went wrong', 'Please try again')
 * showToast.apiError(error, { retry: () => refetch() })
 * ```
 */
export const showToast = {
  /**
   * Show a success toast notification.
   */
  success: (message: string, description?: string) =>
    toast.success(message, { description }),

  /**
   * Show an error toast notification.
   */
  error: (message: string, description?: string) =>
    toast.error(message, { description }),

  /**
   * Show a warning toast notification.
   */
  warning: (message: string, description?: string) =>
    toast.warning(message, { description }),

  /**
   * Show an info toast notification.
   */
  info: (message: string, description?: string) =>
    toast.info(message, { description }),

  /**
   * Show an API error toast with optional retry action.
   * Extracts message from Error object and optionally provides a retry button.
   */
  apiError: (error: Error, options?: { retry?: () => void }) => {
    const message = error.message || 'An error occurred'
    if (options?.retry) {
      toast.error(message, {
        action: {
          label: 'Retry',
          onClick: options.retry,
        },
      })
    } else {
      toast.error(message)
    }
  },

  /**
   * Show a loading toast that can be updated later.
   * Returns the toast ID for updating/dismissing.
   */
  loading: (message: string) => toast.loading(message),

  /**
   * Dismiss a specific toast by ID or all toasts.
   */
  dismiss: (toastId?: string | number) => toast.dismiss(toastId),

  /**
   * Show a promise-based toast that updates based on promise state.
   */
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: Error) => string)
    },
  ) => toast.promise(promise, messages),
}
