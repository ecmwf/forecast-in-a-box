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

import { z } from 'zod'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { PluginBlockFactoryIdSchema } from '@/api/types/fable.types'
import { EnvironmentSpecificationSchema } from '@/api/types/job.types'
import { workflowNameIssue } from '@/features/fable-builder/utils/workflow-names'

/** The export's layout: blocks keyed by instance ID, with sound names. */
const WorkflowFileSchema = z
  .object({
    blocks: z.record(
      z.string(),
      z.object({
        factory_id: PluginBlockFactoryIdSchema,
        configuration_values: z.record(z.string(), z.string()),
        input_ids: z.record(z.string(), z.string()),
      }),
    ),
    environment: EnvironmentSpecificationSchema.nullable().optional(),
    local_glyphs: z.record(z.string(), z.string()).optional(),
  })
  .check((ctx) => {
    const issue = workflowNameIssue(ctx.value)
    if (issue) {
      ctx.issues.push({ code: 'custom', input: ctx.value, ...issue })
    }
  })

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

/** zod drops `__proto__` keys without a word; a file with one is refused. */
function refuseProtoKeys(key: string, value: unknown): unknown {
  if (key === '__proto__') {
    throw new WorkflowFileError('invalid', '__proto__: is a reserved name')
  }
  return value
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
    parsed = JSON.parse(content, refuseProtoKeys)
  } catch (error) {
    if (error instanceof WorkflowFileError) throw error
    throw new WorkflowFileError('parse', messageOf(error))
  }
  const result = WorkflowFileSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues.at(0)
    throw new WorkflowFileError(
      'invalid',
      issue ? `${issue.path.join('.')}: ${issue.message}` : '',
    )
  }
  return result.data
}
