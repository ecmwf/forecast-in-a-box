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
  isStateTooLarge,
} from '@/lib/url-state'
import { FableBuilderV1Schema, serializeFable } from '@/api/types/fable.types'
import { workflowNameIssue } from '@/features/fable-builder/utils/workflow-names'

export { isStateTooLarge }

// FableBuilderV1Schema parses the list wire-format into a dict, so the URL must
// hold the wire-format too — serialize on encode to keep decode symmetric.
export function encodeFableToURL(fable: FableBuilderV1): string {
  return encodeStateToURL(serializeFable(fable))
}

/** The link's workflow; null when it can't be read or names a built-in or missing block. */
export function decodeFableFromURL(encoded: string): FableBuilderV1 | null {
  const fable = decodeStateFromURL(encoded, FableBuilderV1Schema)
  return fable && workflowNameIssue(fable) === null ? fable : null
}
