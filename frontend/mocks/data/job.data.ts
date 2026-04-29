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
  JobExecuteRequest,
  JobExecuteResponse,
  JobExecutionDetail,
} from '@/api/types/job.types'

const now = new Date()
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
const threeDaysAgo = new Date(
  now.getTime() - 3 * 24 * 60 * 60 * 1000,
).toISOString()

// ─── Execution mock state ─────────────────────────────────────────────────

let executionIdCounter = 200

let executionsState: Record<string, JobExecutionDetail> = {}

const seedExecutions: Array<JobExecutionDetail> = [
  {
    run_id: 'job-completed-001',
    attempt_count: 1,
    status: 'completed',
    created_at: threeDaysAgo,
    updated_at: threeDaysAgo,
    blueprint_id: 'def-001',
    blueprint_version: 1,
    error: null,
    progress: '100',
    cascade_job_id: 'cascade-001',
    outputs: {
      outputs: {
        'task-out-1': {
          mime_type: 'image/png',
          original_block: 'sink_temperature_map',
          is_available: true,
        },
        'task-out-2': {
          mime_type: 'image/png',
          original_block: 'sink_temperature_map',
          is_available: true,
        },
        'task-out-3': {
          mime_type: 'image/png',
          original_block: 'sink_wind_map',
          is_available: true,
        },
      },
    },
  },
  {
    run_id: 'job-running-002',
    attempt_count: 1,
    status: 'running',
    created_at: oneHourAgo,
    updated_at: oneHourAgo,
    blueprint_id: 'def-002',
    blueprint_version: 1,
    error: null,
    progress: '45',
    cascade_job_id: 'cascade-002',
    outputs: {
      outputs: {
        'task-out-4': {
          mime_type: 'image/png',
          original_block: 'sink_precipitation',
          is_available: false,
        },
      },
    },
  },
  {
    run_id: 'job-errored-003',
    attempt_count: 1,
    status: 'failed',
    created_at: twoHoursAgo,
    updated_at: twoHoursAgo,
    blueprint_id: 'def-003',
    blueprint_version: 1,
    error: 'Worker process exited with code 137 (OOM killed)',
    progress: '62',
    cascade_job_id: 'cascade-003',
    outputs: {
      outputs: {},
    },
  },
  {
    run_id: 'job-submitted-004',
    attempt_count: 1,
    status: 'submitted',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    blueprint_id: 'def-004',
    blueprint_version: 1,
    error: null,
    progress: '0',
    cascade_job_id: null,
    outputs: null,
  },
]

export function resetJobsState(): void {
  executionsState = {}
  executionIdCounter = 200
  for (const exec of seedExecutions) {
    executionsState[exec.run_id] = JSON.parse(
      JSON.stringify(exec),
    ) as JobExecutionDetail
  }
}

resetJobsState()

// ─── Execution accessors ──────────────────────────────────────────────────

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

export function addExecution(request: JobExecuteRequest): JobExecuteResponse {
  const run_id = `exec-mock-${String(executionIdCounter++).padStart(3, '0')}`
  const timestamp = new Date().toISOString()
  executionsState[run_id] = {
    run_id,
    attempt_count: 1,
    status: 'submitted',
    created_at: timestamp,
    updated_at: timestamp,
    blueprint_id: request.blueprint_id,
    blueprint_version: request.blueprint_version ?? 1,
    error: null,
    progress: '0',
    cascade_job_id: null,
    outputs: null,
  }
  return { run_id, attempt_count: 1 }
}

export function restartExecution(
  executionId: string,
): { run_id: string; attempt_count: number } | undefined {
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
  return { run_id: executionId, attempt_count }
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
