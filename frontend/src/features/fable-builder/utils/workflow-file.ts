/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Reading an exported workflow file (`Export workflow`) back into a builder fable. */

import type { FableBuilderV1 } from '@/api/types/fable.types'

/** Larger files are refused before reading. */
export const MAX_WORKFLOW_FILE_BYTES = 1024 * 1024

export type WorkflowFileErrorCode = 'tooLarge' | 'read' | 'parse' | 'invalid'

export class WorkflowFileError extends Error {
  constructor(
    readonly code: WorkflowFileErrorCode,
    message = '',
  ) {
    super(message)
    this.name = 'WorkflowFileError'
  }
}

/** A workflow name from its file name, without the export's date and `_workflow` suffix. */
export function workflowNameFromFile(fileName: string): string {
  return (
    fileName
      .replace(/\.json$/i, '')
      // Browsers number repeated downloads, e.g. `name (1).json`.
      .replace(/\s*\(\d+\)$/, '')
      .replace(/(_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})?_workflow$/i, '')
      .replace(/_+/g, ' ')
      .trim()
  )
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The file's fable; rejects with a WorkflowFileError. */
export async function readWorkflowFile(file: File): Promise<FableBuilderV1> {
  if (file.size > MAX_WORKFLOW_FILE_BYTES) {
    throw new WorkflowFileError('tooLarge')
  }
  let content: string
  try {
    content = await file.text()
  } catch (error) {
    throw new WorkflowFileError('read', messageOf(error))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new WorkflowFileError('parse', messageOf(error))
  }
  // Blocks keyed by instance ID, as the export writes them.
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('blocks' in parsed) ||
    !parsed.blocks ||
    typeof parsed.blocks !== 'object' ||
    Array.isArray(parsed.blocks)
  ) {
    throw new WorkflowFileError('invalid')
  }
  return parsed as FableBuilderV1
}
