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
 * Job & Execution Types
 */

export type JobStatus =
  | 'submitted'
  | 'running'
  | 'completed'
  | 'errored'
  | 'invalid'
  | 'timeout'
  | 'unknown'

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  'completed',
  'errored',
  'invalid',
  'timeout',
  'unknown',
])

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** GET /job/{job_id}/status */
export interface JobProgressResponse {
  progress: string
  status: JobStatus
  created_at: string | null
  error: string | null
}

/** GET /job/status */
export interface JobProgressResponses {
  progresses: Record<string, JobProgressResponse>
  total: number
  page: number
  page_size: number
  total_pages: number
  error: string | null
}

/** GET /job/{job_id}/outputs */
export interface ProductToOutputId {
  product_name: string
  product_spec: Record<string, unknown>
  output_ids: Array<string>
}

/** POST /execution/execute */
export interface SubmitJobResponse {
  id: string
}

export interface EnvironmentSpecification {
  hosts: number | null
  workers_per_host: number | null
  environment_variables: Record<string, string>
}

export interface ModelSpecification {
  model: string
  date: string
  lead_time: number
  ensemble_members: number
}

export interface ProductSpecification {
  product: string
  specification: Record<string, unknown>
}

export interface ForecastProducts {
  job_type: 'forecast_products'
  model: ModelSpecification
  products: Array<ProductSpecification>
}

export interface RawCascadeJob {
  job_type: 'raw_cascade_job'
  job_instance: unknown
}

export type JobSpecification = ForecastProducts | RawCascadeJob

export interface ExecutionSpecification {
  job: JobSpecification
  environment: EnvironmentSpecification
  shared: boolean
}

export function createDefaultEnvironment(): EnvironmentSpecification {
  return {
    hosts: null,
    workers_per_host: null,
    environment_variables: {},
  }
}

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; color: string }
> = {
  submitted: { label: 'Submitted', color: 'blue' },
  running: { label: 'Running', color: 'amber' },
  completed: { label: 'Completed', color: 'green' },
  errored: { label: 'Errored', color: 'red' },
  invalid: { label: 'Invalid', color: 'red' },
  timeout: { label: 'Timeout', color: 'orange' },
  unknown: { label: 'Unknown', color: 'gray' },
} as const
