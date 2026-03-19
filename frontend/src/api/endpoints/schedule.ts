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
 * Schedule API Endpoints
 */

import type {
  CreateScheduleResponse,
  ScheduleDefinitionResponse,
  ScheduleListResponse,
  ScheduleRunsResponse,
  ScheduleSpecification,
  ScheduleUpdate,
} from '@/api/types/schedule.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'

export async function getSchedules(
  page: number = 1,
  pageSize: number = 10,
  enabled?: boolean,
): Promise<ScheduleListResponse> {
  const params: Record<string, string | number> = { page, page_size: pageSize }
  if (enabled !== undefined) {
    params.enabled = String(enabled)
  }
  return apiClient.get(API_ENDPOINTS.schedule.list, { params })
}

export async function getSchedule(
  experimentId: string,
): Promise<ScheduleDefinitionResponse> {
  return apiClient.get(API_ENDPOINTS.schedule.get, {
    params: { experiment_id: experimentId },
  })
}

export async function createSchedule(
  spec: ScheduleSpecification,
): Promise<CreateScheduleResponse> {
  return apiClient.put(API_ENDPOINTS.schedule.create, spec)
}

export async function updateSchedule(
  experimentId: string,
  update: ScheduleUpdate,
): Promise<unknown> {
  return apiClient.post(API_ENDPOINTS.schedule.update, update, {
    params: { experiment_id: experimentId },
  })
}

export async function deleteSchedule(experimentId: string): Promise<unknown> {
  return apiClient.post(API_ENDPOINTS.schedule.delete, null, {
    params: { experiment_id: experimentId },
  })
}

export async function getScheduleRuns(
  experimentId: string,
  page: number = 1,
  pageSize: number = 10,
  status?: string,
): Promise<ScheduleRunsResponse> {
  const params: Record<string, string | number> = {
    experiment_id: experimentId,
    page,
    page_size: pageSize,
  }
  if (status) {
    params.status = status
  }
  return apiClient.get(API_ENDPOINTS.schedule.runs, { params })
}

export async function getScheduleNextRun(
  experimentId: string,
): Promise<string> {
  return apiClient.get(API_ENDPOINTS.schedule.nextRun, {
    params: { experiment_id: experimentId },
  })
}
