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
import { apiClient, apiErrorFromResponse, buildUrl } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { readAnonymousId } from '@/lib/anonymous-id'

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

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {}
  // Same validated read as apiClient.
  const anonymousId = readAnonymousId()
  if (anonymousId) {
    headers['X-Anonymous-ID'] = anonymousId
  }
  return headers
}

export async function getJobStatus(
  runId: string,
  attemptCount?: number,
): Promise<JobExecutionDetail> {
  const params: Record<string, string | number> = { run_id: runId }
  if (attemptCount != null) {
    params.attempt_count = attemptCount
  }
  return apiClient.get(API_ENDPOINTS.job.get, {
    params,
    schema: JobExecutionDetailSchema,
  })
}

export async function getJobResult(
  runId: string,
  datasetId: string,
): Promise<{ blob: Blob; contentType: string }> {
  const url = buildUrl(API_ENDPOINTS.job.outputContent, {
    run_id: runId,
    dataset_id: datasetId,
  })

  const response = await fetch(url, {
    credentials: 'include',
    headers: buildHeaders(),
  })

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Failed to fetch result: ${response.statusText}`,
    )
  }

  const blob = await response.blob()
  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream'
  return { blob, contentType }
}

/**
 * Fetch only the leading `byteCount` bytes of an output — enough for magic-byte
 * MIME sniffing without pulling a multi-gigabyte GRIB/NetCDF payload.
 *
 * Sends a `Range` header; a server that honours it replies `206` with just the
 * slice. A server (or dev proxy) that ignores Range replies `200` with the full
 * body — still correct, since the caller only ever reads the first bytes.
 */
export async function getJobResultHead(
  runId: string,
  datasetId: string,
  byteCount: number,
): Promise<Uint8Array> {
  const url = buildUrl(API_ENDPOINTS.job.outputContent, {
    run_id: runId,
    dataset_id: datasetId,
  })

  const response = await fetch(url, {
    credentials: 'include',
    headers: { ...buildHeaders(), Range: `bytes=0-${byteCount - 1}` },
  })

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Failed to fetch result head: ${response.statusText}`,
    )
  }

  const buf = await response.arrayBuffer()
  // A Range-ignoring server returns the whole body; slice to the head we need.
  return new Uint8Array(buf, 0, Math.min(buf.byteLength, byteCount))
}

export async function downloadJobLogs(runId: string): Promise<Blob> {
  const url = buildUrl(API_ENDPOINTS.job.logs, {
    run_id: runId,
  })

  const response = await fetch(url, {
    credentials: 'include',
    headers: buildHeaders(),
  })

  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Failed to download logs: ${response.statusText}`,
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
