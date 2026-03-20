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
    refetchOnWindowFocus: false,
  })
}

export function useSchedule(experimentId: string | undefined) {
  return useQuery<ScheduleDefinitionResponse>({
    queryKey: scheduleKeys.detail(experimentId ?? ''),
    queryFn: () => getSchedule(experimentId!),
    enabled: !!experimentId,
    refetchOnWindowFocus: false,
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
    refetchOnWindowFocus: false,
  })
}

export function useScheduleNextRun(experimentId: string | undefined) {
  return useQuery<string>({
    queryKey: scheduleKeys.nextRun(experimentId ?? ''),
    queryFn: () => getScheduleNextRun(experimentId!),
    enabled: !!experimentId,
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
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
