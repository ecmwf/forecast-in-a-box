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
  JobExecuteV2Request,
  JobExecuteV2Response,
  JobExecutionDetail,
  JobExecutionListV2,
  JobStatus,
  ProductToOutputId,
} from '@/api/types/job.types'
import { ApiClientError, apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { getBackendBaseUrl } from '@/utils/env'
import { STORAGE_KEYS } from '@/lib/storage-keys'

export async function executeJobV2(
  request: JobExecuteV2Request,
): Promise<JobExecuteV2Response> {
  return apiClient.post(API_ENDPOINTS.job.execute, request)
}

export async function getJobsStatusV2(
  page: number = 1,
  pageSize: number = 10,
  status?: JobStatus,
): Promise<JobExecutionListV2> {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (status) {
    params.status = status
  }
  return apiClient.get(API_ENDPOINTS.job.status, { params })
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

export async function getJobStatusV2(
  executionId: string,
): Promise<JobExecutionDetail> {
  return apiClient.get(API_ENDPOINTS.job.statusById(executionId))
}

export async function getJobOutputsV2(
  executionId: string,
): Promise<Array<ProductToOutputId>> {
  return apiClient.get(API_ENDPOINTS.job.outputs(executionId))
}

export async function getJobAvailableV2(
  executionId: string,
): Promise<Array<string>> {
  return apiClient.get(API_ENDPOINTS.job.available(executionId))
}

export async function getJobResultV2(
  executionId: string,
  datasetId: string,
): Promise<{ blob: Blob; contentType: string }> {
  const url = buildFullUrl(API_ENDPOINTS.job.results(executionId), {
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

export async function downloadJobLogsV2(executionId: string): Promise<Blob> {
  const url = buildFullUrl(API_ENDPOINTS.job.logs(executionId))

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

export async function restartJobV2(
  executionId: string,
): Promise<JobExecuteV2Response> {
  return apiClient.post(API_ENDPOINTS.job.restart(executionId))
}

export async function deleteJobV2(executionId: string): Promise<void> {
  return apiClient.delete(
    `${API_ENDPOINTS.job.delete}?execution_id=${executionId}`,
  )
}
