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
 * Job API Hooks
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18n from 'i18next'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type {
  CompilationDetailResponse,
  EnvironmentSpecification,
  JobExecuteResponse,
  JobExecutionDetail,
  JobExecutionList,
  JobStatus,
} from '@/api/types/job.types'
import { ApiClientError } from '@/api/client'
import { isTerminalStatus } from '@/api/types/job.types'
import {
  deleteJob,
  executeJob,
  getCompilationDetail,
  getJobStatus,
  getJobsStatus,
  restartJob,
  stopJob,
} from '@/api/endpoints/job'
import { upsertFable } from '@/api/endpoints/fable'
import { withOneoffTag } from '@/lib/system-tags'
import { showToast } from '@/lib/toast'
import { scheduleKeys } from '@/api/hooks/useSchedules'
import { shareRunDetail, shareRunList } from '@/api/hooks/run-status-sharing'

export const jobKeys = {
  all: ['jobs'] as const,
  status: (jobId: string) => [...jobKeys.all, 'status', jobId] as const,
  list: (page: number, pageSize: number, status?: JobStatus) =>
    [...jobKeys.all, 'list', page, pageSize, status] as const,
  compilation: (jobId: string) =>
    [...jobKeys.all, 'compilation', jobId] as const,
}

export function useJobStatus(jobId: string | undefined) {
  return useQuery<JobExecutionDetail>({
    queryKey: jobKeys.status(jobId ?? ''),
    queryFn: () => getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return 2000
      if (isTerminalStatus(status)) return false
      return status === 'submitted' ? 2000 : 3000
    },
    refetchOnWindowFocus: false,
    // Busy while the gateway stops a run; the next poll catches up.
    meta: { expectedErrorStatuses: [503] },
    structuralSharing: shareRunDetail,
  })
}

/** Compilation detail is server-cached and may be absent for older runs or
 * after the cache entry expires. 404 is a normal "not available" signal,
 * not an error: don't retry, and consumers branch on `error.status === 404`. */
export function useCompilationDetail(
  jobId: string | undefined,
  status: JobStatus | undefined,
) {
  return useQuery<CompilationDetailResponse>({
    queryKey: jobKeys.compilation(jobId ?? ''),
    queryFn: () => getCompilationDetail(jobId!),
    // Wait for status so we don't fire during the initial load tick.
    enabled: !!jobId && !!status,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (count, error) => {
      if (error instanceof ApiClientError && error.status === 404) return false
      return count < 2
    },
  })
}

/** One request serves every "newest runs" consumer; callers take a slice. */
const RECENT_RUNS_WINDOW = 20

export function useRecentRuns(count: number) {
  return useQuery({
    queryKey: jobKeys.list(1, RECENT_RUNS_WINDOW),
    queryFn: () => getJobsStatus(1, RECENT_RUNS_WINDOW),
    select: (data: JobExecutionList) =>
      data.runs.slice(0, Math.min(count, RECENT_RUNS_WINDOW)),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
    meta: { expectedErrorStatuses: [503] },
    structuralSharing: shareRunList,
  })
}

export function useJobsStatus(
  page: number = 1,
  pageSize: number = 10,
  status?: JobStatus,
) {
  return useQuery<JobExecutionList>({
    queryKey: jobKeys.list(page, pageSize, status),
    queryFn: () => getJobsStatus(page, pageSize, status),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
    meta: { expectedErrorStatuses: [503] },
    structuralSharing: shareRunList,
  })
}

export function useRestartJob() {
  const queryClient = useQueryClient()

  return useMutation<
    JobExecuteResponse,
    Error,
    { runId: string; attemptCount: number }
  >({
    mutationFn: ({ runId, attemptCount }) => restartJob(runId, attemptCount),
    onSuccess: (_data, { runId }) => {
      queryClient.invalidateQueries({ queryKey: jobKeys.status(runId) })
    },
  })
}

/** Stop an active run; its cached detail reads `stopping` at once. */
export function useStopJob() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { runId: string; attemptCount: number }>({
    mutationFn: ({ runId, attemptCount }) => stopJob(runId, attemptCount),
    meta: { expectedErrorStatuses: [409, 503] },
    onMutate: ({ runId }) => {
      queryClient.setQueryData<JobExecutionDetail>(
        jobKeys.status(runId),
        (detail) =>
          detail && !isTerminalStatus(detail.status)
            ? { ...detail, status: 'stopping' }
            : detail,
      )
    },
    onError: (error) => {
      if (!(error instanceof ApiClientError)) return
      // 409: it finished first; 503: recorded, the backend retries the stop.
      if (error.status === 409) {
        showToast.info(i18n.t('executions:actions.stopAlreadyFinished'))
      } else if (error.status === 503) {
        showToast.info(i18n.t('executions:actions.stopQueued'))
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all })
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
    },
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { runId: string; attemptCount: number }>({
    mutationFn: ({ runId, attemptCount }) => deleteJob(runId, attemptCount),
    // 409: not finished; callers show the backend's reason instead.
    meta: { expectedErrorStatuses: [409] },
    onSuccess: (_data, { runId }) => {
      // Gone for good: a refetch would only 404 behind the navigation.
      queryClient.removeQueries({ queryKey: jobKeys.status(runId) })
      void queryClient.invalidateQueries({ queryKey: jobKeys.all })
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
    },
  })
}

interface SubmitFableParams {
  fable: FableBuilderV1
  name: string | null
  description: string | null
  tags: Array<string>
  fableId: string | null
  environment?: EnvironmentSpecification
}

export function useSubmitFable() {
  return useMutation<{ run_id: string }, Error, SubmitFableParams>({
    mutationFn: async ({ fable, name, description, tags, fableId }) => {
      const { blueprint_id, version } = await upsertFable({
        builder: fable,
        display_name: name,
        display_description: description,
        // Mark the blueprint as a one-off run — keeps it out of saved presets.
        tags: withOneoffTag(tags),
        parent_id: fableId ?? undefined,
      })

      return executeJob({
        blueprint_id,
        blueprint_version: version,
      })
    },
  })
}
