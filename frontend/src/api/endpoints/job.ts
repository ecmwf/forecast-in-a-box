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
 * Job & Execution API Endpoints
 */

import type {
  JobExecuteRequest,
  JobExecuteResponse,
  JobExecutionDetail,
  JobExecutionList,
  JobStatus,
} from '@/api/types/job.types'
import {
  JobExecuteResponseSchema,
  JobExecutionDetailSchema,
  JobExecutionListSchema,
} from '@/api/types/job.types'
import { ApiClientError, apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { getBackendBaseUrl } from '@/utils/env'
import { STORAGE_KEYS } from '@/lib/storage-keys'

export async function executeJob(
  request: JobExecuteRequest,
): Promise<JobExecuteResponse> {
  return apiClient.post(API_ENDPOINTS.job.create, request, {
    schema: JobExecuteResponseSchema,
  })
}

export async function getJobsStatus(
  page: number = 1,
  pageSize: number = 10,
  status?: JobStatus,
): Promise<JobExecutionList> {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (status) {
    params.status = status
  }
  return apiClient.get(API_ENDPOINTS.job.list, {
    params,
    schema: JobExecutionListSchema,
  })
}

function buildFullUrl(path: string, params?: Record<string, string>): string {
  const baseUrl = getBackendBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const fullPath = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}${normalizedPath}`
    : normalizedPath

  if (!params || Object.keys(params).length === 0) {
    return fullPath
  }

  const searchParams = new URLSearchParams(params)
  return `${fullPath}?${searchParams.toString()}`
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {}
  const anonymousId = localStorage.getItem(STORAGE_KEYS.auth.anonymousId)
  if (anonymousId) {
    headers['X-Anonymous-ID'] = anonymousId
  }
  return headers
}

export async function getJobStatus(runId: string): Promise<JobExecutionDetail> {
  return apiClient.get(API_ENDPOINTS.job.get, {
    params: { run_id: runId },
    schema: JobExecutionDetailSchema,
  })
}

export async function getJobResult(
  runId: string,
  datasetId: string,
): Promise<{ blob: Blob; contentType: string }> {
  const url = buildFullUrl(API_ENDPOINTS.job.outputContent, {
    run_id: runId,
    dataset_id: datasetId,
  })

  const response = await fetch(url, {
    credentials: 'include',
    headers: buildHeaders(),
  })

  if (!response.ok) {
    throw new ApiClientError(
      `Failed to fetch result: ${response.statusText}`,
      response.status,
    )
  }

  const blob = await response.blob()
  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream'
  return { blob, contentType }
}

/**
 * Probe the output's MIME type without downloading the full body.
 *
 * We issue a GET and abort as soon as the response headers arrive. A HEAD
 * request would be cheaper on paper, but Vite's dev proxy doesn't forward
 * HEAD to /api routes — the SPA fallback intercepts and serves index.html
 * (text/html). GET + abort works uniformly in dev and prod, still avoids
 * downloading multi-gigabyte GRIB/NetCDF payloads.
 */
export async function headJobResultContentType(
  runId: string,
  datasetId: string,
): Promise<string | null> {
  const url = buildFullUrl(API_ENDPOINTS.job.outputContent, {
    run_id: runId,
    dataset_id: datasetId,
  })
  const controller = new AbortController()
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildHeaders(),
      signal: controller.signal,
    })
    // Headers have arrived — abort to cancel body streaming.
    controller.abort()
    if (!response.ok) return null
    return response.headers.get('content-type')
  } catch (err) {
    // AbortError can fire if the abort races the fetch resolution; treat
    // as "unknown mime type" rather than propagating.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null
    }
    throw err
  }
}

export async function downloadJobLogs(runId: string): Promise<Blob> {
  const url = buildFullUrl(API_ENDPOINTS.job.logs, {
    run_id: runId,
  })

  const response = await fetch(url, {
    credentials: 'include',
    headers: buildHeaders(),
  })

  if (!response.ok) {
    throw new ApiClientError(
      `Failed to download logs: ${response.statusText}`,
      response.status,
    )
  }

  return response.blob()
}

export async function restartJob(
  runId: string,
  attemptCount: number,
): Promise<JobExecuteResponse> {
  return apiClient.post(
    API_ENDPOINTS.job.restart,
    { run_id: runId, attempt_count: attemptCount },
    {
      schema: JobExecuteResponseSchema,
    },
  )
}

export async function deleteJob(
  runId: string,
  attemptCount: number,
): Promise<void> {
  return apiClient.post(API_ENDPOINTS.job.delete, {
    run_id: runId,
    attempt_count: attemptCount,
  })
}
