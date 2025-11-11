/**
 * TypeScript type definitions for i18next
 * Provides type-safe translation keys
 */

import 'i18next'
import type translationEN from '@/locales/en/translation.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof translationEN
    }
  }
}
