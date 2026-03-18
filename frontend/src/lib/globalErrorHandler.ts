/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { createLogger } from './logger'
import { showToast } from './toast'

const log = createLogger('GlobalError')

/**
 * Extracts a user-friendly message from an error of unknown type.
 */
function extractErrorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
  }
  if (typeof reason === 'string') {
    return reason
  }
  return 'An unexpected error occurred'
}

/**
 * Sets up global error handlers for uncaught errors and unhandled promise rejections.
 * Should be called once at application startup (in main.tsx).
 *
 * These handlers:
 * 1. Log errors using the centralized logger
 * 2. Show user-friendly toast notifications
 * 3. Allow default browser error handling to continue
 */
export function setupGlobalErrorHandlers(): void {
  // Handle uncaught synchronous errors
  window.onerror = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ): boolean => {
    log.error('Uncaught error:', {
      message,
      source,
      lineno,
      colno,
      error: error?.stack || error,
    })

    showToast.error(
      'An unexpected error occurred',
      'Please try refreshing the page',
    )

    // Return false to allow default browser error handling (e.g., DevTools logging)
    return false
  }

  // Handle unhandled promise rejections
  window.addEventListener(
    'unhandledrejection',
    (event: PromiseRejectionEvent) => {
      const reason = event.reason

      log.error('Unhandled promise rejection:', {
        reason:
          reason instanceof Error ? reason.stack || reason.message : reason,
      })

      showToast.error(extractErrorMessage(reason))
    },
  )

  log.info('Global error handlers initialized')
}
