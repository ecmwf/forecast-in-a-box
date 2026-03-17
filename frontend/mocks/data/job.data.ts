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
 * Mock data for job & execution API
 */

import type {
  ExecutionSpecification,
  JobExecuteRequest,
  JobExecuteResponse,
  JobExecutionDetail,
  JobProgressResponse,
  ProductToOutputId,
} from '@/api/types/job.types'

export interface MockJob {
  id: string
  status: JobProgressResponse
  specification: ExecutionSpecification
  outputs: Array<ProductToOutputId>
  available: Array<string>
}

const now = new Date()
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
const threeDaysAgo = new Date(
  now.getTime() - 3 * 24 * 60 * 60 * 1000,
).toISOString()

const defaultSpec: ExecutionSpecification = {
  job: {
    job_type: 'raw_cascade_job',
    job_instance: { tasks: {}, edges: [] },
  },
  environment: {
    hosts: null,
    workers_per_host: null,
    environment_variables: {},
  },
  shared: false,
}

const seedJobs: Array<MockJob> = [
  {
    id: 'job-completed-001',
    status: {
      progress: '100',
      status: 'completed',
      created_at: threeDaysAgo,
      error: null,
    },
    specification: defaultSpec,
    outputs: [
      {
        product_name: 'temperature_map',
        product_spec: { variable: '2t' },
        output_ids: ['task-out-1', 'task-out-2'],
      },
      {
        product_name: 'wind_map',
        product_spec: { variable: '10u' },
        output_ids: ['task-out-3'],
      },
    ],
    available: ['task-out-1', 'task-out-2', 'task-out-3'],
  },
  {
    id: 'job-running-002',
    status: {
      progress: '45',
      status: 'running',
      created_at: oneHourAgo,
      error: null,
    },
    specification: defaultSpec,
    outputs: [
      {
        product_name: 'precipitation_forecast',
        product_spec: { variable: 'tp' },
        output_ids: ['task-out-4'],
      },
    ],
    available: [],
  },
  {
    id: 'job-errored-003',
    status: {
      progress: '62',
      status: 'errored',
      created_at: twoHoursAgo,
      error: 'Worker process exited with code 137 (OOM killed)',
    },
    specification: defaultSpec,
    outputs: [],
    available: [],
  },
  {
    id: 'job-submitted-004',
    status: {
      progress: '0',
      status: 'submitted',
      created_at: now.toISOString(),
      error: null,
    },
    specification: defaultSpec,
    outputs: [],
    available: [],
  },
]

let jobIdCounter = 100

let jobsState: Record<string, MockJob> = {}

// ─── V2 execution mock state ───────────────────────────────────────────────

let executionIdCounter = 200

let executionsState: Record<string, JobExecutionDetail> = {}

const seedExecutionsV2: Array<JobExecutionDetail> = [
  {
    execution_id: 'job-completed-001',
    attempt_count: 1,
    status: 'completed',
    created_at: threeDaysAgo,
    updated_at: threeDaysAgo,
    job_definition_id: 'def-001',
    job_definition_version: 1,
    error: null,
    progress: '100',
    cascade_job_id: 'cascade-001',
  },
  {
    execution_id: 'job-running-002',
    attempt_count: 1,
    status: 'running',
    created_at: oneHourAgo,
    updated_at: oneHourAgo,
    job_definition_id: 'def-002',
    job_definition_version: 1,
    error: null,
    progress: '45',
    cascade_job_id: 'cascade-002',
  },
  {
    execution_id: 'job-errored-003',
    attempt_count: 1,
    status: 'errored',
    created_at: twoHoursAgo,
    updated_at: twoHoursAgo,
    job_definition_id: 'def-003',
    job_definition_version: 1,
    error: 'Worker process exited with code 137 (OOM killed)',
    progress: '62',
    cascade_job_id: 'cascade-003',
  },
  {
    execution_id: 'job-submitted-004',
    attempt_count: 1,
    status: 'submitted',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    job_definition_id: 'def-004',
    job_definition_version: 1,
    error: null,
    progress: '0',
    cascade_job_id: null,
  },
]

export function resetJobsState(): void {
  jobsState = {}
  for (const job of seedJobs) {
    jobsState[job.id] = JSON.parse(JSON.stringify(job)) as MockJob
  }
  executionsState = {}
  for (const exec of seedExecutionsV2) {
    executionsState[exec.execution_id] = JSON.parse(
      JSON.stringify(exec),
    ) as JobExecutionDetail
  }
}

resetJobsState()

export function getAllJobs(): Array<MockJob> {
  return Object.values(jobsState).sort((a, b) => {
    const aTime = a.status.created_at
      ? new Date(a.status.created_at).getTime()
      : 0
    const bTime = b.status.created_at
      ? new Date(b.status.created_at).getTime()
      : 0
    return bTime - aTime
  })
}

export function getJob(jobId: string): MockJob | undefined {
  return jobsState[jobId]
}

export function addJob(spec: ExecutionSpecification): MockJob {
  const id = `job-mock-${String(jobIdCounter++).padStart(3, '0')}`
  const job: MockJob = {
    id,
    status: {
      progress: '0',
      status: 'submitted',
      created_at: new Date().toISOString(),
      error: null,
    },
    specification: spec,
    outputs: [],
    available: [],
  }
  jobsState[id] = job
  return job
}

// ─── V2 execution accessors ────────────────────────────────────────────────

export function getAllExecutions(): Array<JobExecutionDetail> {
  return Object.values(executionsState).sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function getExecution(
  executionId: string,
): JobExecutionDetail | undefined {
  return executionsState[executionId]
}

export function addExecution(
  request: JobExecuteRequest,
): JobExecuteResponse {
  const execution_id = `exec-mock-${String(executionIdCounter++).padStart(3, '0')}`
  const timestamp = new Date().toISOString()
  executionsState[execution_id] = {
    execution_id,
    attempt_count: 1,
    status: 'submitted',
    created_at: timestamp,
    updated_at: timestamp,
    job_definition_id: request.job_definition_id,
    job_definition_version: request.job_definition_version ?? 1,
    error: null,
    progress: '0',
    cascade_job_id: null,
  }
  return { execution_id, attempt_count: 1 }
}

export function deleteJob(jobId: string): boolean {
  if (!(jobId in jobsState)) {
    return false
  }
  delete jobsState[jobId]
  return true
}

export function restartExecution(
  executionId: string,
): { execution_id: string; attempt_count: number } | undefined {
  if (!(executionId in executionsState)) return undefined
  const exec = executionsState[executionId]
  const attempt_count = exec.attempt_count + 1
  executionsState[executionId] = {
    ...exec,
    attempt_count,
    status: 'submitted',
    progress: '0',
    updated_at: new Date().toISOString(),
  }
  return { execution_id: executionId, attempt_count }
}

export function deleteExecution(executionId: string): boolean {
  if (!(executionId in executionsState)) return false
  delete executionsState[executionId]
  return true
}

export function createMockPngBlob(): Blob {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  return new Blob([pngBytes], { type: 'image/png' })
}
