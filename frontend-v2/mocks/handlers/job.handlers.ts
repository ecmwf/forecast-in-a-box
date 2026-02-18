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
 * MSW Handlers for Job & Execution API
 */

import { HttpResponse, delay, http } from 'msw'
import {
  addJob,
  createMockPngBlob,
  deleteJob,
  getAllJobs,
  getJob,
} from '../data/job.data'
import type { ExecutionSpecification, JobStatus } from '@/api/types/job.types'
import { API_ENDPOINTS, API_PATTERNS } from '@/api/endpoints'

export const jobHandlers = [
  http.post(API_ENDPOINTS.execution.execute, async ({ request }) => {
    await delay(400)

    let spec: ExecutionSpecification
    try {
      spec = (await request.json()) as ExecutionSpecification
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    const job = addJob(spec)
    return HttpResponse.json({ id: job.id })
  }),

  http.post(API_ENDPOINTS.execution.visualise, async () => {
    await delay(300)
    return HttpResponse.json({ id: `vis-${Date.now()}` })
  }),

  http.get(API_ENDPOINTS.job.status, async ({ request }) => {
    await delay(200)

    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    const pageSize = parseInt(url.searchParams.get('page_size') ?? '10', 10)
    const statusFilter = url.searchParams.get('status') as JobStatus | null

    let jobs = getAllJobs()
    if (statusFilter) {
      jobs = jobs.filter((j) => j.status.status === statusFilter)
    }

    const total = jobs.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const start = (page - 1) * pageSize
    const pageJobs = jobs.slice(start, start + pageSize)

    const progresses: Record<string, (typeof pageJobs)[number]['status']> = {}
    for (const job of pageJobs) {
      progresses[job.id] = job.status
    }

    return HttpResponse.json({
      progresses,
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
      error: null,
    })
  }),

  http.get(API_PATTERNS.job.statusById, async ({ params }) => {
    await delay(150)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    return HttpResponse.json(job.status)
  }),

  http.get(API_PATTERNS.job.outputs, async ({ params }) => {
    await delay(200)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    return HttpResponse.json(job.outputs)
  }),

  http.get(API_PATTERNS.job.available, async ({ params }) => {
    await delay(150)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    return HttpResponse.json(job.available)
  }),

  http.get(API_PATTERNS.job.results, async ({ params, request }) => {
    await delay(300)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const datasetId = url.searchParams.get('dataset_id')

    if (!datasetId) {
      return HttpResponse.json(
        { detail: 'Missing dataset_id parameter' },
        { status: 400 },
      )
    }

    const blob = createMockPngBlob()
    return new HttpResponse(blob, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(blob.size),
      },
    })
  }),

  http.get(API_PATTERNS.job.logs, async ({ params }) => {
    await delay(200)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    const zipBytes = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    return new HttpResponse(zipBytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${jobId}-logs.zip"`,
      },
    })
  }),

  http.get(API_PATTERNS.job.specification, async ({ params }) => {
    await delay(200)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    return HttpResponse.json(job.specification)
  }),

  http.post(API_PATTERNS.job.restart, async ({ params }) => {
    await delay(400)

    const jobId = params.jobId as string
    const job = getJob(jobId)

    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    const newJob = addJob(job.specification)
    return HttpResponse.json({ id: newJob.id })
  }),

  http.delete(API_PATTERNS.job.delete, async ({ params }) => {
    await delay(200)

    const jobId = params.jobId as string
    const deleted = deleteJob(jobId)

    if (!deleted) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }

    return HttpResponse.json({ deleted_count: 1 })
  }),
]
