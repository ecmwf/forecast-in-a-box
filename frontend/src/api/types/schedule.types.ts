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
 * Schedule Types
 *
 * TypeScript types matching the backend schedule API (Pydantic models).
 */

import type { JobStatus } from '@/api/types/job.types'

/** PUT /schedule/create - request body */
export interface ScheduleSpecification {
  job_definition_id: string
  job_definition_version?: number
  cron_expr: string
  dynamic_expr: Record<string, unknown>
  max_acceptable_delay_hours: number
  display_name?: string
  display_description?: string
  tags?: Array<string>
}

/** POST /schedule/update - request body (all fields optional) */
export interface ScheduleUpdate {
  enabled?: boolean
  cron_expr?: string
  dynamic_expr?: Record<string, unknown>
  max_acceptable_delay_hours?: number
  display_name?: string
  display_description?: string
  tags?: Array<string>
}

/** GET /schedule/get - response */
export interface ScheduleDefinitionResponse {
  experiment_id: string
  experiment_version: number
  job_definition_id: string
  job_definition_version: number
  cron_expr: string | null
  dynamic_expr: Record<string, unknown>
  max_acceptable_delay_hours: number
  enabled: boolean
  created_at: string
  created_by: string | null
  display_name: string | null
  display_description: string | null
  tags: Array<string> | null
}

/** GET /schedule/list - paginated response */
export interface ScheduleListResponse {
  schedules: Array<ScheduleDefinitionResponse>
  total: number
  page: number
  page_size: number
  total_pages: number
}

/** PUT /schedule/create - response */
export interface CreateScheduleResponse {
  experiment_id: string
}

export type ScheduleRunTrigger = 'cron' | 'rerun' | 'cron_skipped' | 'event'

/** GET /schedule/runs - individual run */
export interface ScheduleRunResponse {
  execution_id: string
  attempt_count: number
  experiment_id: string
  status: JobStatus | null
  trigger: ScheduleRunTrigger
  scheduled_at: string
  created_at: string
}

/** GET /schedule/runs - paginated response */
export interface ScheduleRunsResponse {
  runs: Array<ScheduleRunResponse>
  total: number
  page: number
  page_size: number
  total_pages: number
}
