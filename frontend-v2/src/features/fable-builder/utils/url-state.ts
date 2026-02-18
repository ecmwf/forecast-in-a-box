/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { FableBuilderV1 } from '@/api/types/fable.types'
import {
  decodeStateFromURL,
  encodeStateToURL,
  getCompressionStats,
  isStateTooLarge,
} from '@/lib/url-state'
import { FableBuilderV1Schema } from '@/api/types/fable.types'

export { isStateTooLarge }

export function encodeFableToURL(fable: FableBuilderV1): string {
  return encodeStateToURL(fable)
}

export function decodeFableFromURL(encoded: string): FableBuilderV1 | null {
  return decodeStateFromURL(encoded, FableBuilderV1Schema)
}

export function getFableCompressionStats(
  fable: FableBuilderV1,
): ReturnType<typeof getCompressionStats> {
  return getCompressionStats(fable)
}
