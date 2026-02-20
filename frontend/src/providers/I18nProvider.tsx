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
 * Internationalization Provider
 *
 * Wraps the application with i18next configuration.
 * Currently, i18n is initialized via a side-effect import,
 * but this provider can be extended in the future to support
 * runtime language switching or SSR.
 */

import { I18nextProvider } from 'react-i18next'
import type { ReactNode } from 'react'
import i18n from '@/lib/i18n'

interface I18nProviderProps {
  children: ReactNode
}

/**
 * Provider component for internationalization
 * Provides i18next instance to all child components
 */
export function I18nProvider({ children }: I18nProviderProps) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
