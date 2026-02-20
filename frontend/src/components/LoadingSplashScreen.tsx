/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Loading Splash Screen Component
 *
 * Displays a full-screen loading indicator while the application
 * configuration is being loaded on initial startup.
 *
 * Shows:
 * - Spinning loader animation
 * - "Loading configuration..." message
 * - Optional error message if config loading fails
 */

import { useEffect, useState } from 'react'
import { H2, P } from '@/components/base/typography'

interface LoadingSplashScreenProps {
  /** Error message to display, if any */
  error?: string | null

  /** Callback for retry button (shown on error) */
  onRetry?: () => void
}

export function LoadingSplashScreen({
  error,
  onRetry,
}: LoadingSplashScreenProps) {
  const [dots, setDots] = useState('')

  // Animate dots for loading message
  useEffect(() => {
    if (error) return // Don't animate if there's an error

    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'))
    }, 500)

    return () => clearInterval(interval)
  }, [error])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Animated Spinner */}
        {!error && (
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        )}

        {/* Error Icon */}
        {error && (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <svg
              className="h-8 w-8 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        )}

        {/* Loading Message */}
        {!error && (
          <div className="space-y-2">
            <H2 className="text-xl font-semibold">
              Loading configuration{dots}
            </H2>
            <P className="text-muted-foreground">
              Please wait while we set up the application
            </P>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="max-w-md space-y-4">
            <H2 className="text-xl font-semibold text-destructive">
              Configuration Error
            </H2>
            <P className="text-muted-foreground">
              Failed to load application configuration:
            </P>
            <div className="rounded-lg bg-destructive/10 p-4">
              <P className="font-mono text-destructive">{error}</P>
            </div>

            {/* Retry Button */}
            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Retry
              </button>
            )}

            <P className="text-muted-foreground">
              If the problem persists, please contact support.
            </P>
          </div>
        )}
      </div>
    </div>
  )
}
