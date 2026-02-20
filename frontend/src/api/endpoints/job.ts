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
  ExecutionSpecification,
  JobProgressResponse,
  JobProgressResponses,
  JobStatus,
  ProductToOutputId,
  SubmitJobResponse,
} from '@/api/types/job.types'
import { ApiClientError, apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { getBackendBaseUrl } from '@/utils/env'
import { STORAGE_KEYS } from '@/lib/storage-keys'

export async function executeJob(
  spec: ExecutionSpecification,
): Promise<SubmitJobResponse> {
  return apiClient.post(API_ENDPOINTS.execution.execute, spec)
}

export async function getJobsStatus(
  page: number = 1,
  pageSize: number = 10,
  status?: JobStatus,
): Promise<JobProgressResponses> {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (status) {
    params.status = status
  }
  return apiClient.get(API_ENDPOINTS.job.status, { params })
}

export async function getJobStatus(
  jobId: string,
): Promise<JobProgressResponse> {
  return apiClient.get(API_ENDPOINTS.job.statusById(jobId))
}

export async function getJobOutputs(
  jobId: string,
): Promise<Array<ProductToOutputId>> {
  return apiClient.get(API_ENDPOINTS.job.outputs(jobId))
}

export async function getJobAvailable(jobId: string): Promise<Array<string>> {
  return apiClient.get(API_ENDPOINTS.job.available(jobId))
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

export async function getJobResult(
  jobId: string,
  datasetId: string,
): Promise<{ blob: Blob; contentType: string }> {
  const url = buildFullUrl(API_ENDPOINTS.job.results(jobId), {
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

export async function downloadJobLogs(jobId: string): Promise<Blob> {
  const url = buildFullUrl(API_ENDPOINTS.job.logs(jobId))

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

export async function restartJob(jobId: string): Promise<SubmitJobResponse> {
  return apiClient.post(API_ENDPOINTS.job.restart(jobId))
}

export async function deleteJob(
  jobId: string,
): Promise<{ deleted_count: number }> {
  return apiClient.delete(API_ENDPOINTS.job.delete(jobId))
}

export async function getJobSpecification(
  jobId: string,
): Promise<ExecutionSpecification> {
  return apiClient.get(API_ENDPOINTS.job.specification(jobId))
}
