/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Names in a workflow from outside the app, checked before the builder looks them up. */

import type { FableBuilderV1 } from '@/api/types/fable.types'

/** Names every plain object already has, such as `constructor`. */
const BUILT_IN_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype))

export interface WorkflowNameIssue {
  path: Array<string>
  message: string
}

/** The first block or glyph name that is a built-in, or input naming no block; null when all are sound. */
export function workflowNameIssue(
  fable: Pick<FableBuilderV1, 'blocks' | 'local_glyphs'>,
): WorkflowNameIssue | null {
  // A `__proto__` key set while converting would have changed it.
  if (Object.getPrototypeOf(fable.blocks) !== Object.prototype) {
    return { path: ['blocks'], message: 'holds a reserved name' }
  }
  for (const name of Object.keys(fable.blocks)) {
    if (BUILT_IN_NAMES.has(name)) {
      return { path: ['blocks', name], message: 'is a reserved name' }
    }
  }
  for (const name of Object.keys(fable.local_glyphs ?? {})) {
    if (BUILT_IN_NAMES.has(name)) {
      return { path: ['local_glyphs', name], message: 'is a reserved name' }
    }
  }
  for (const [id, block] of Object.entries(fable.blocks)) {
    for (const [input, parent] of Object.entries(block.input_ids)) {
      if (parent === '' || Object.hasOwn(fable.blocks, parent)) continue
      return {
        path: ['blocks', id, 'input_ids', input],
        message: `no block '${parent}' in the workflow`,
      }
    }
  }
  return null
}
