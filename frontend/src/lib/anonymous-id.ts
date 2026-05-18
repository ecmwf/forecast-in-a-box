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
 * Validated access to the anonymous user ID — the X-Anonymous-ID header value.
 * Reads reject any stored value that isn't a valid UUID.
 */

import { readStorage } from '@/lib/storage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when `value` is a valid UUID. */
export function isValidAnonymousId(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value)
}

/** The stored anonymous ID, or `null` if absent or not a valid UUID. */
export function readAnonymousId(): string | null {
  const stored = readStorage(STORAGE_KEYS.auth.anonymousId)
  return isValidAnonymousId(stored) ? stored : null
}
