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
 * Schedule Types & Schemas
 *
 * TypeScript types matching the backend schedule API.
 */

import { z } from 'zod'
import { JobStatusSchema } from '@/api/types/job.types'

// ---------------------------------------------------------------------------
// Schemas — must match backend dataclasses in routers/schedule.py
// ---------------------------------------------------------------------------

/** schedule.py: ScheduleDefinitionResponse */
export const ScheduleDefinitionResponseSchema = z.object({
  experiment_id: z.string(),
  experiment_version: z.number(),
  blueprint_id: z.string(),
  blueprint_version: z.number(),
  cron_expr: z.string(),
  dynamic_expr: z.record(z.string(), z.string()),
  max_acceptable_delay_hours: z.number(),
  enabled: z.boolean(),
  created_at: z.string(),
  created_by: z.string().nullable(),
  display_name: z.string().nullable(),
  display_description: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
})

/** schedule.py: ListSchedulesResponse */
export const ScheduleListResponseSchema = z.object({
  schedules: z.array(ScheduleDefinitionResponseSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  error: z.string().nullable(),
})

/** schedule.py: CreateScheduleResponse */
export const CreateScheduleResponseSchema = z.object({
  experiment_id: z.string(),
})

/** schedule.py: ScheduleRunResponse; status narrowed from str to known values) */
export const ScheduleRunResponseSchema = z.object({
  run_id: z.string(),
  attempt_count: z.number(),
  status: JobStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  experiment_context: z.string().nullable(),
})

/** schedule.py: ScheduleRunsResponse */
export const ScheduleRunsResponseSchema = z.object({
  runs: z.array(ScheduleRunResponseSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
  error: z.string().nullable(),
})

// ---------------------------------------------------------------------------
// Types (derived from schemas)
// ---------------------------------------------------------------------------

export type ScheduleDefinitionResponse = z.infer<
  typeof ScheduleDefinitionResponseSchema
>
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>
export type CreateScheduleResponse = z.infer<
  typeof CreateScheduleResponseSchema
>
export type ScheduleRunResponse = z.infer<typeof ScheduleRunResponseSchema>
export type ScheduleRunsResponse = z.infer<typeof ScheduleRunsResponseSchema>

/** PUT /experiment/create - request body (not validated — outbound only) */
export interface ScheduleSpecification {
  blueprint_id: string
  blueprint_version?: number
  cron_expr: string
  dynamic_expr: Record<string, unknown>
  max_acceptable_delay_hours: number
  first_run_override?: string
  display_name?: string
  display_description?: string
  tags?: Array<string>
}

/** POST /experiment/update - request body (not validated — outbound only) */
export interface ScheduleUpdate {
  enabled?: boolean
  cron_expr?: string
  dynamic_expr?: Record<string, unknown>
  max_acceptable_delay_hours?: number
  first_run_override?: string
  display_name?: string
  display_description?: string
  tags?: Array<string>
}
