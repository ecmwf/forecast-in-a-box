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
 * Language Synchronization Hook
 *
 * Synchronizes language between configStore (server config) and:
 * - globalStore (legacy locale storage)
 * - i18next (internationalization library)
 *
 * The source of truth is configStore.language (from server config).
 */

import { useEffect } from 'react'
import { useLanguage } from './useConfig'
import i18n from '@/lib/i18n'
import { createLogger } from '@/lib/logger'

const log = createLogger('LanguageSync')

/**
 * Synchronize language with i18next
 *
 * Call this hook in a top-level component (e.g., __root.tsx) to ensure
 * language is synced when config loads or changes.
 *
 * Note: Previously synced with globalStore.locale, but that has been removed
 * as configStore is now the single source of truth for language.
 */
export function useLanguageSync() {
  const configLanguage = useLanguage()

  useEffect(() => {
    // Sync i18next with config language
    if (i18n.language !== configLanguage) {
      i18n.changeLanguage(configLanguage).catch((error) => {
        log.error('Failed to change i18n language:', error)
      })
    }
  }, [configLanguage])
}
