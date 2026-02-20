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
 * Application Providers
 *
 * Combines all application-level providers into a single component.
 * This makes it easy to add/remove/reorder providers from a central location.
 */

import { QueryProvider } from './QueryProvider'
import { AuthProvider } from './AuthProvider'
import { I18nProvider } from './I18nProvider'
import { ThemeProvider } from './ThemeProvider'
import { ToastProvider } from './ToastProvider'
import type { ReactNode } from 'react'

interface AppProvidersProps {
  children: ReactNode
}

/**
 * Combined application providers
 *
 * Provider order matters:
 * 1. I18nProvider - i18n must be available early
 * 2. ThemeProvider - theme should be applied early
 * 3. QueryProvider - TanStack Query for data fetching
 * 4. AuthProvider - authentication context
 * 5. ToastProvider - toast notifications (last, needs everything else)
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </QueryProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

// Export individual providers for flexibility
export { QueryProvider } from './QueryProvider'
export { AuthProvider } from './AuthProvider'
export { I18nProvider } from './I18nProvider'
export { ThemeProvider } from './ThemeProvider'
export { ToastProvider } from './ToastProvider'
