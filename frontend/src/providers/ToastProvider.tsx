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
 * Toast Notification Provider
 *
 * Provides toast notifications using sonner library.
 * Use the `showToast` utility from `@/lib/toast` to trigger notifications.
 */

import { Toaster } from 'sonner'
import type { ReactNode } from 'react'

interface ToastProviderProps {
  children: ReactNode
}

/**
 * Provider component for toast notifications.
 * Renders the Toaster component that displays toast messages.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <>
      {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        duration={5000}
        toastOptions={{
          className: 'text-sm',
        }}
      />
    </>
  )
}
