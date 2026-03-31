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
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type {
  EnvironmentSpecification,
  JobExecuteResponse,
  JobExecutionDetail,
  JobExecutionList,
  JobStatus,
} from '@/api/types/job.types'
import { isTerminalStatus } from '@/api/types/job.types'
import {
  deleteJob,
  executeJob,
  getJobAvailable,
  getJobStatus,
  getJobsStatus,
  restartJob,
} from '@/api/endpoints/job'
import { upsertFable } from '@/api/endpoints/fable'

export const jobKeys = {
  all: ['jobs'] as const,
  status: (jobId: string) => [...jobKeys.all, 'status', jobId] as const,
  list: (page: number, pageSize: number, status?: JobStatus) =>
    [...jobKeys.all, 'list', page, pageSize, status] as const,
  available: (jobId: string) => [...jobKeys.all, 'available', jobId] as const,
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
  })
}

export function useJobAvailable(
  jobId: string | undefined,
  jobStatus?: JobStatus,
) {
  return useQuery<Array<string>>({
    queryKey: jobKeys.available(jobId ?? ''),
    queryFn: () => getJobAvailable(jobId!),
    enabled: !!jobId,
    refetchInterval: () => {
      if (!jobStatus) return 5000
      if (isTerminalStatus(jobStatus)) return false
      return 5000
    },
    refetchOnWindowFocus: false,
  })
}

export function useRestartJob() {
  const queryClient = useQueryClient()

  return useMutation<
    JobExecuteResponse,
    Error,
    { executionId: string; attemptCount: number }
  >({
    mutationFn: ({ executionId, attemptCount }) =>
      restartJob(executionId, attemptCount),
    onSuccess: (_data, { executionId }) => {
      queryClient.invalidateQueries({ queryKey: jobKeys.status(executionId) })
    },
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return useMutation<
    void,
    Error,
    { executionId: string; attemptCount: number }
  >({
    mutationFn: ({ executionId, attemptCount }) =>
      deleteJob(executionId, attemptCount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all })
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
  return useMutation<{ execution_id: string }, Error, SubmitFableParams>({
    mutationFn: async ({ fable, name, description, tags, fableId }) => {
      const { job_definition_id, version } = await upsertFable({
        builder: fable,
        display_name: name,
        display_description: description,
        tags,
        parent_id: fableId ?? undefined,
      })

      return executeJob({
        job_definition_id,
        job_definition_version: version,
      })
    },
  })
}
