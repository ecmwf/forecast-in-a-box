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
  addExecution,
  createMockPngBlob,
  deleteExecution,
  getAllExecutions,
  getExecution,
  getJob,
  restartExecution,
} from '../data/job.data'
import type { JobExecuteRequest, JobStatus } from '@/api/types/job.types'
import { API_ENDPOINTS } from '@/api/endpoints'

export const jobHandlers = [
  http.post(API_ENDPOINTS.job.create, async ({ request }) => {
    await delay(400)

    let body: JobExecuteRequest
    try {
      body = (await request.json()) as JobExecuteRequest
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    const result = addExecution(body)
    return HttpResponse.json(result)
  }),

  http.get(API_ENDPOINTS.job.list, async ({ request }) => {
    await delay(200)

    const url = new URL(request.url)
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    const pageSize = parseInt(url.searchParams.get('page_size') ?? '10', 10)
    const statusFilter = url.searchParams.get('status') as JobStatus | null

    let executions = getAllExecutions()
    if (statusFilter) {
      executions = executions.filter((e) => e.status === statusFilter)
    }

    const total = executions.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const start = (page - 1) * pageSize
    const pageExecutions = executions.slice(start, start + pageSize)

    return HttpResponse.json({
      runs: pageExecutions,
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    })
  }),

  http.get(API_ENDPOINTS.job.get, async ({ request }) => {
    await delay(150)

    const url = new URL(request.url)
    const executionId = url.searchParams.get('run_id')

    if (!executionId) {
      return HttpResponse.json(
        { detail: 'Missing run_id parameter' },
        { status: 400 },
      )
    }

    const exec = getExecution(executionId)

    if (!exec) {
      return HttpResponse.json(
        { detail: 'Execution not found' },
        { status: 404 },
      )
    }

    return HttpResponse.json(exec)
  }),

  http.post(API_ENDPOINTS.job.restart, async ({ request }) => {
    await delay(400)

    const body = (await request.json()) as {
      run_id: string
      attempt_count: number
    }
    const executionId = body.run_id
    const result = restartExecution(executionId)

    if (!result) {
      return HttpResponse.json(
        { detail: 'Execution not found' },
        { status: 404 },
      )
    }

    return HttpResponse.json(result)
  }),

  http.get(API_ENDPOINTS.job.outputAvailability, async ({ request }) => {
    await delay(150)

    const url = new URL(request.url)
    const executionId = url.searchParams.get('run_id')

    if (!executionId) {
      return HttpResponse.json(
        { detail: 'Missing run_id parameter' },
        { status: 400 },
      )
    }

    const exec = getExecution(executionId)

    if (!exec) {
      return HttpResponse.json(
        { detail: 'Execution not found' },
        { status: 404 },
      )
    }

    const job = getJob(executionId)
    return HttpResponse.json(job?.available ?? [])
  }),

  http.get(API_ENDPOINTS.job.outputContent, async ({ request }) => {
    await delay(300)

    const url = new URL(request.url)
    const executionId = url.searchParams.get('run_id')
    const datasetId = url.searchParams.get('dataset_id')

    if (!executionId) {
      return HttpResponse.json(
        { detail: 'Missing run_id parameter' },
        { status: 400 },
      )
    }

    const exec = getExecution(executionId)

    if (!exec) {
      return HttpResponse.json(
        { detail: 'Execution not found' },
        { status: 404 },
      )
    }

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

  http.get(API_ENDPOINTS.job.logs, async ({ request }) => {
    await delay(200)

    const url = new URL(request.url)
    const executionId = url.searchParams.get('run_id')

    if (!executionId) {
      return HttpResponse.json(
        { detail: 'Missing run_id parameter' },
        { status: 400 },
      )
    }

    const exec = getExecution(executionId)

    if (!exec) {
      return HttpResponse.json(
        { detail: 'Execution not found' },
        { status: 404 },
      )
    }

    const zipBytes = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    return new HttpResponse(zipBytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${executionId}-logs.zip"`,
      },
    })
  }),

  http.post(API_ENDPOINTS.job.delete, async ({ request }) => {
    await delay(200)

    const body = (await request.json()) as {
      run_id: string
      attempt_count: number
    }
    const executionId = body.run_id

    if (!executionId) {
      return HttpResponse.json(
        { detail: 'Missing run_id parameter' },
        { status: 400 },
      )
    }

    const deleted = deleteExecution(executionId)

    if (!deleted) {
      return HttpResponse.json(
        { detail: 'Execution not found' },
        { status: 404 },
      )
    }

    return new HttpResponse(null, { status: 200 })
  }),
]
