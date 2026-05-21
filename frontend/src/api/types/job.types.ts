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
 * Job & Execution Types & Schemas
 */

import { z } from 'zod'
import i18n from 'i18next'

// ---------------------------------------------------------------------------
// Schemas — must match backend models in routes/run.py
// ---------------------------------------------------------------------------

export const JobStatusSchema = z.enum([
  'submitted',
  'preparing',
  'running',
  'completed',
  'failed',
  'unknown',
])

/** routes/run.py: JobExecuteResponse */
export const JobExecuteResponseSchema = z.object({
  run_id: z.string(),
  attempt_count: z.number(),
})

/** routes/run.py: RunOutputDetail */
export const RunOutputMetadataSchema = z.object({
  mime_type: z.string(),
  original_block: z.string(),
  is_available: z.boolean(),
})

/** routes/run.py: RunOutputsResponse — backend wraps the dict in `{ outputs: ... }`;
 * we flatten on parse so consumers can access `details.outputs[taskId]` directly. */
export const RunOutputsSchema = z
  .object({
    outputs: z.record(z.string(), RunOutputMetadataSchema),
  })
  .transform((wrapper) => wrapper.outputs)

/** routes/run.py: JobExecutionDetail. `*_block_ids` are only set on
 * /run/get and clear to `null` on terminal status, so both `null` and
 * `undefined` are valid wire shapes. */
export const JobExecutionDetailSchema = z.object({
  run_id: z.string(),
  attempt_count: z.number(),
  status: JobStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  blueprint_id: z.string(),
  blueprint_version: z.number(),
  error: z.string().nullable(),
  progress: z.string().nullable(),
  cascade_job_id: z.string().nullable(),
  outputs: RunOutputsSchema.nullable(),
  completed_block_ids: z.array(z.string()).nullable().optional(),
  planned_block_ids: z.array(z.string()).nullable().optional(),
})

/** routes/run.py: JobExecutionList */
export const JobExecutionListSchema = z.object({
  runs: z.array(JobExecutionDetailSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
})

/** fiab_core/artifacts.py: CompositeArtifactId */
export const CompositeArtifactIdSchema = z.object({
  artifact_store_id: z.string(),
  artifact_local_id: z.string(),
})

/** domain/blueprint/cascade.py: EnvironmentSpecification */
export const EnvironmentSpecificationSchema = z.object({
  hosts: z.number().nullable(),
  workers_per_host: z.number().nullable(),
  environment_variables: z.record(z.string(), z.string()),
  runtime_artifacts: z.array(CompositeArtifactIdSchema).default([]),
})

// ---------------------------------------------------------------------------
// Types (derived from schemas)
// ---------------------------------------------------------------------------

export type JobStatus = z.infer<typeof JobStatusSchema>

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  'completed',
  'failed',
])

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export type JobExecuteResponse = z.infer<typeof JobExecuteResponseSchema>
export type RunOutputMetadata = z.infer<typeof RunOutputMetadataSchema>
export type RunOutputs = z.infer<typeof RunOutputsSchema>
export type JobExecutionDetail = z.infer<typeof JobExecutionDetailSchema>
export type JobExecutionList = z.infer<typeof JobExecutionListSchema>
export type EnvironmentSpecification = z.infer<
  typeof EnvironmentSpecificationSchema
>

/** POST /run/create request (not validated — outbound only) */
export interface JobExecuteRequest {
  blueprint_id: string
  blueprint_version?: number
}

export function createDefaultEnvironment(): EnvironmentSpecification {
  return {
    hosts: null,
    workers_per_host: null,
    environment_variables: {},
    runtime_artifacts: [],
  }
}

// `label` is a getter so it resolves through i18next on access (at render),
// keeping this module free of the i18n initialisation side-effect.
export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; color: string }
> = {
  submitted: {
    get label() {
      return i18n.t('executions:status.submitted')
    },
    color: 'blue',
  },
  preparing: {
    get label() {
      return i18n.t('executions:status.preparing')
    },
    color: 'blue',
  },
  running: {
    get label() {
      return i18n.t('executions:status.running')
    },
    color: 'amber',
  },
  completed: {
    get label() {
      return i18n.t('executions:status.completed')
    },
    color: 'green',
  },
  failed: {
    get label() {
      return i18n.t('executions:status.failed')
    },
    color: 'red',
  },
  unknown: {
    get label() {
      return i18n.t('executions:status.unknown')
    },
    color: 'gray',
  },
}
