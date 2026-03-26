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
 * Schedule API Hooks
 */

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type {
  CreateScheduleResponse,
  ScheduleDefinitionResponse,
  ScheduleListResponse,
  ScheduleRunsResponse,
  ScheduleUpdate,
} from '@/api/types/schedule.types'
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  getScheduleCurrentTime,
  getScheduleNextRun,
  getScheduleRuns,
  getSchedules,
  updateSchedule,
} from '@/api/endpoints/schedule'
import { upsertFable } from '@/api/endpoints/fable'

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: (page: number, pageSize: number, enabled?: boolean) =>
    [...scheduleKeys.all, 'list', page, pageSize, enabled] as const,
  detail: (experimentId: string) =>
    [...scheduleKeys.all, 'detail', experimentId] as const,
  runs: (
    experimentId: string,
    page: number,
    pageSize: number,
    status?: string,
  ) =>
    [
      ...scheduleKeys.all,
      'runs',
      experimentId,
      page,
      pageSize,
      status,
    ] as const,
  nextRun: (experimentId: string) =>
    [...scheduleKeys.all, 'nextRun', experimentId] as const,
  serverTime: [...['schedules'], 'serverTime'] as const,
}

export function useSchedules(
  page: number = 1,
  pageSize: number = 10,
  enabled?: boolean,
) {
  return useQuery<ScheduleListResponse>({
    queryKey: scheduleKeys.list(page, pageSize, enabled),
    queryFn: () => getSchedules(page, pageSize, enabled),
    refetchInterval: 30000,
  })
}

export function useSchedule(experimentId: string | undefined) {
  return useQuery<ScheduleDefinitionResponse>({
    queryKey: scheduleKeys.detail(experimentId ?? ''),
    queryFn: () => getSchedule(experimentId!),
    enabled: !!experimentId,
  })
}

export function useScheduleRuns(
  experimentId: string | undefined,
  page: number = 1,
  pageSize: number = 10,
  status?: string,
) {
  return useQuery<ScheduleRunsResponse>({
    queryKey: scheduleKeys.runs(experimentId ?? '', page, pageSize, status),
    queryFn: () => getScheduleRuns(experimentId!, page, pageSize, status),
    enabled: !!experimentId,
    refetchInterval: 30000,
  })
}

export function useScheduleNextRun(experimentId: string | undefined) {
  return useQuery<string>({
    queryKey: scheduleKeys.nextRun(experimentId ?? ''),
    queryFn: () => getScheduleNextRun(experimentId!),
    enabled: !!experimentId,
    refetchInterval: 60000,
  })
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient()

  return useMutation<
    unknown,
    Error,
    { experimentId: string; update: ScheduleUpdate }
  >({
    mutationFn: ({ experimentId, update }) =>
      updateSchedule(experimentId, update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
    },
  })
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient()

  return useMutation<unknown, Error, string>({
    mutationFn: deleteSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
    },
  })
}

/**
 * Fetches the scheduler's current time and computes the offset from the client clock.
 *
 * The offset lets us translate naive datetime strings returned by the server
 * (which are in the server's local timezone) into correct client-local Dates.
 *
 * Formula: correctEpoch = new Date(serverTimeStr).getTime() - offsetMs
 */
/**
 * Parse a naive datetime string from the backend.
 *
 * The backend's current_scheduling_time() uses datetime.now() which returns
 * a naive datetime in the server's local timezone (no timezone suffix).
 * We parse it consistently with new Date() — the offset calculation and
 * conversion both use the same parsing, so any timezone difference cancels out.
 */
function parseServerTime(dateStr: string): number {
  return new Date(dateStr.trim()).getTime()
}

export function useServerTime() {
  const { data: offsetMs } = useQuery<number>({
    queryKey: scheduleKeys.serverTime,
    queryFn: async () => {
      const serverTimeStr = await getScheduleCurrentTime()
      const serverParsed = parseServerTime(serverTimeStr)
      const clientNow = Date.now()
      const rawOffset = serverParsed - clientNow
      // Round to nearest minute — cron has minute precision, and network
      // latency introduces sub-minute jitter that corrupts exact cron times
      return Math.round(rawOffset / 60_000) * 60_000
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const serverTimeToLocal = useCallback(
    (serverTimeStr: string, { roundMinute = false } = {}): Date => {
      const parsed = parseServerTime(serverTimeStr)
      let epoch = offsetMs == null ? parsed : parsed - offsetMs
      if (roundMinute) {
        epoch = Math.round(epoch / 60_000) * 60_000
      }
      return new Date(epoch)
    },
    [offsetMs],
  )

  const serverHourMinuteToLocal = useCallback(
    (hour: number, minute: number): { hour: number; minute: number } => {
      if (offsetMs == null) return { hour, minute }
      // Build a reference date with the given server hour/minute
      const ref = new Date()
      ref.setHours(hour, minute, 0, 0)
      // ref is now interpreted as client-local; adjust by offset to get true local time
      const local = new Date(ref.getTime() - offsetMs)
      return { hour: local.getHours(), minute: local.getMinutes() }
    },
    [offsetMs],
  )

  return {
    offsetMs: offsetMs ?? null,
    isLoaded: offsetMs != null,
    serverTimeToLocal,
    serverHourMinuteToLocal,
  }
}

interface CreateScheduleParams {
  fable: FableBuilderV1
  name: string
  description: string
  tags: Array<string>
  fableId: string | null
  cronExpr: string
  maxAcceptableDelayHours: number
  dynamicExpr: Record<string, unknown>
}

export function useCreateSchedule() {
  const queryClient = useQueryClient()

  return useMutation<CreateScheduleResponse, Error, CreateScheduleParams>({
    mutationFn: async ({
      fable,
      name,
      description,
      tags,
      fableId,
      cronExpr,
      maxAcceptableDelayHours,
      dynamicExpr,
    }) => {
      // Upsert the fable to get a persisted id/version
      const { id, version } = await upsertFable({
        builder: fable,
        display_name: name,
        display_description: description,
        tags,
        parent_id: fableId ?? undefined,
      })

      return createSchedule({
        job_definition_id: id,
        job_definition_version: version,
        cron_expr: cronExpr,
        dynamic_expr: dynamicExpr,
        max_acceptable_delay_hours: maxAcceptableDelayHours,
        display_name: name,
        display_description: description,
        tags,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
    },
  })
}
