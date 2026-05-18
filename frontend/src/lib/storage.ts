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
 * Safe localStorage helpers for non-hook code — every access is guarded
 * (localStorage can throw) and failures are logged, not thrown.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('storage')

/** Read a string; null if absent or storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (error) {
    log.warn('Failed to read localStorage', { key, error })
    return null
  }
}

/** Write a string; no-op if storage is unavailable. */
export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    log.warn('Failed to write localStorage', { key, error })
  }
}

/** Remove a key; no-op if storage is unavailable. */
export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    log.warn('Failed to remove localStorage', { key, error })
  }
}

/** Read and JSON-parse a value; null if absent, unavailable or corrupt. */
export function readStorageJson<T>(key: string): T | null {
  const raw = readStorage(key)
  if (raw === null || raw === '') return null
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    log.warn('Failed to parse stored JSON', { key, error })
    return null
  }
}

/** JSON-stringify and write a value; no-op if storage is unavailable. */
export function writeStorageJson(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value))
}
