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

import { z } from 'zod'
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

export async function getJobStatus(
  executionId: string,
): Promise<JobExecutionDetail> {
  return apiClient.get(API_ENDPOINTS.job.get, {
    params: { run_id: executionId },
    schema: JobExecutionDetailSchema,
  })
}

export async function getJobAvailable(
  executionId: string,
): Promise<Array<string>> {
  return apiClient.get(API_ENDPOINTS.job.outputAvailability, {
    params: { run_id: executionId },
    schema: z.array(z.string()),
  })
}

export async function getJobResult(
  executionId: string,
  datasetId: string,
): Promise<{ blob: Blob; contentType: string }> {
  const url = buildFullUrl(API_ENDPOINTS.job.outputContent, {
    run_id: executionId,
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

export async function downloadJobLogs(executionId: string): Promise<Blob> {
  const url = buildFullUrl(API_ENDPOINTS.job.logs, {
    run_id: executionId,
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
  executionId: string,
  attemptCount: number,
): Promise<JobExecuteResponse> {
  return apiClient.post(
    API_ENDPOINTS.job.restart,
    { run_id: executionId, attempt_count: attemptCount },
    {
      schema: JobExecuteResponseSchema,
    },
  )
}

export async function deleteJob(
  executionId: string,
  attemptCount: number,
): Promise<void> {
  return apiClient.post(API_ENDPOINTS.job.delete, {
    run_id: executionId,
    attempt_count: attemptCount,
  })
}
