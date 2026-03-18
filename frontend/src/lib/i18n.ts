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
 * i18next Configuration
 * Internationalization setup for the FIAB application
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Import translation resources by namespace
import commonEN from '@/locales/en/common.json'
import statusEN from '@/locales/en/status.json'
import landingEN from '@/locales/en/landing.json'
import authEN from '@/locales/en/auth.json'
import errorsEN from '@/locales/en/errors.json'
import validationEN from '@/locales/en/validation.json'
import dashboardEN from '@/locales/en/dashboard.json'
import pluginsEN from '@/locales/en/plugins.json'
import sourcesEN from '@/locales/en/sources.json'
import executionsEN from '@/locales/en/executions.json'

// Translation resources organized by namespace
const resources = {
  en: {
    common: commonEN,
    status: statusEN,
    landing: landingEN,
    auth: authEN,
    errors: errorsEN,
    validation: validationEN,
    dashboard: dashboardEN,
    plugins: pluginsEN,
    sources: sourcesEN,
    executions: executionsEN,
  },
}

// Initialize i18next
i18n
  .use(initReactI18next) // Passes i18n down to react-i18next to make it available for all the components
  .init({
    resources,
    lng: 'en', // Default language
    fallbackLng: 'en', // Fallback language if translation not found

    // Namespace configuration
    defaultNS: 'common', // Default namespace for translations
    ns: [
      'common',
      'status',
      'landing',
      'auth',
      'errors',
      'validation',
      'dashboard',
      'plugins',
      'sources',
      'executions',
    ],

    // Interpolation options
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React options
    react: {
      useSuspense: false, // Disable Suspense to avoid loading issues
    },

    // Debug in development
    debug: import.meta.env.DEV,
  })

export default i18n
