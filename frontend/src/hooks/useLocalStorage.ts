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
 * useLocalStorage Hook
 *
 * React hook for managing state synchronized with localStorage.
 * Provides type-safe storage with JSON serialization.
 */

import { useCallback, useEffect, useState } from 'react'
import i18n from 'i18next'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('LocalStorage')

/**
 * Hook to use localStorage with React state
 *
 * @param key - localStorage key
 * @param initialValue - Default value if key doesn't exist
 * @returns [storedValue, setValue] tuple
 *
 * @example
 * const [name, setName] = useLocalStorage('user-name', 'Anonymous')
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((val: T) => T)) => void] {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue
    }
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key)
      // Parse stored json or if none return initialValue
      return item ? (JSON.parse(item) as T) : initialValue
    } catch (error) {
      // If error also return initialValue
      log.error(`Error loading localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // Stable setter that persists to localStorage. The functional-update form
  // resolves against the updater's live `prev`, so successive calls before a
  // re-render don't read a stale value.
  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue((prev) => {
        const valueToStore = value instanceof Function ? value(prev) : value
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(key, JSON.stringify(valueToStore))
          }
        } catch (error) {
          log.error(`Error setting localStorage key "${key}":`, error)
          showToast.error(
            i18n.t('errors:toast.saveSettingFailed'),
            error instanceof Error ? error.message : String(error),
          )
        }
        return valueToStore
      })
    },
    [key],
  )

  // Listen for changes in other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setStoredValue(JSON.parse(e.newValue) as T)
        } catch (error) {
          log.error(`Error parsing localStorage change for "${key}":`, error)
          showToast.warning(
            i18n.t('errors:toast.syncSettingFailed'),
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [key])

  return [storedValue, setValue]
}
