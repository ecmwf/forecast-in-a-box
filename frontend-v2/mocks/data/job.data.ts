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

export function resetJobsState(): void {
  jobsState = {}
  for (const job of seedJobs) {
    jobsState[job.id] = JSON.parse(JSON.stringify(job)) as MockJob
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

export function deleteJob(jobId: string): boolean {
  if (!(jobId in jobsState)) {
    return false
  }
  delete jobsState[jobId]
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
