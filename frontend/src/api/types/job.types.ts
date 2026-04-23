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

/** routes/run.py: ProductToOutputId */
export const ProductToOutputIdSchema = z.object({
  product_name: z.string(),
  product_spec: z.record(z.string(), z.unknown()),
  output_ids: z.array(z.string()),
})

/** routes/run.py: JobExecuteResponse */
export const JobExecuteResponseSchema = z.object({
  run_id: z.string(),
  attempt_count: z.number(),
})

/** routes/run.py: JobExecutionDetail (status narrowed from str to known values) */
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
  ml_model_checkpoint_id: z.string(),
})

/** domain/blueprint/cascade.py: EnvironmentSpecification */
export const EnvironmentSpecificationSchema = z.object({
  hosts: z.number().nullable(),
  workers_per_host: z.number().nullable(),
  environment_variables: z.record(z.string(), z.string()),
  runtime_artifacts: z.array(CompositeArtifactIdSchema).default([]),
})

/** routes/run.py: RawCascadeJob */
const RawCascadeJobSchema = z.object({
  job_type: z.literal('raw_cascade_job'),
  job_instance: z.unknown(),
})

/** routes/run.py: ExecutionSpecification */
export const ExecutionSpecificationSchema = z.object({
  job: RawCascadeJobSchema,
  environment: EnvironmentSpecificationSchema,
  shared: z.boolean(),
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

export type ProductToOutputId = z.infer<typeof ProductToOutputIdSchema>
export type JobExecuteResponse = z.infer<typeof JobExecuteResponseSchema>
export type JobExecutionDetail = z.infer<typeof JobExecutionDetailSchema>
export type JobExecutionList = z.infer<typeof JobExecutionListSchema>
export type EnvironmentSpecification = z.infer<
  typeof EnvironmentSpecificationSchema
>
export type ExecutionSpecification = z.infer<
  typeof ExecutionSpecificationSchema
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

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; color: string }
> = {
  submitted: { label: 'Submitted', color: 'blue' },
  preparing: { label: 'Preparing', color: 'blue' },
  running: { label: 'Running', color: 'amber' },
  completed: { label: 'Completed', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  unknown: { label: 'Unknown', color: 'gray' },
} as const
