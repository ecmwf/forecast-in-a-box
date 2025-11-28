/*
 * (C) Copyright 2025- ECMWF and individual contributors.
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

// Import translation resources
import translationEN from '@/locales/en/translation.json'

// Translation resources
const resources = {
  en: {
    translation: translationEN,
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
    defaultNS: 'translation',
    ns: ['translation'],

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
