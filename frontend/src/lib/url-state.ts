/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import lzString from 'lz-string'
import type { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('URLState')

const MAX_SAFE_STATE_LENGTH = 1800

export function encodeStateToURL<T>(state: T): string {
  return lzString.compressToEncodedURIComponent(JSON.stringify(state))
}

export function decodeStateFromURL<T>(
  encoded: string,
  schema: z.ZodSchema<T>,
): T | null {
  try {
    const json = lzString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    return schema.parse(JSON.parse(json))
  } catch (error) {
    log.warn('Failed to decode state from URL:', error)
    return null
  }
}

export function isStateTooLarge(encoded: string): boolean {
  return encoded.length > MAX_SAFE_STATE_LENGTH
}

export function getCompressionStats<T>(state: T): {
  originalSize: number
  compressedSize: number
  ratio: number
} {
  const json = JSON.stringify(state)
  const compressed = encodeStateToURL(state)
  return {
    originalSize: json.length,
    compressedSize: compressed.length,
    ratio: compressed.length / json.length,
  }
}
