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
  headJobResultContentType,
  restartJob,
} from '@/api/endpoints/job'
import { upsertFable } from '@/api/endpoints/fable'

export const jobKeys = {
  all: ['jobs'] as const,
  status: (jobId: string) => [...jobKeys.all, 'status', jobId] as const,
  list: (page: number, pageSize: number, status?: JobStatus) =>
    [...jobKeys.all, 'list', page, pageSize, status] as const,
  available: (jobId: string) => [...jobKeys.all, 'available', jobId] as const,
  contentType: (jobId: string, datasetId: string) =>
    [...jobKeys.all, 'contentType', jobId, datasetId] as const,
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

/**
 * Probe the MIME type of a single output via a HEAD request.
 * Lightweight (no body transfer); cached so repeat mounts don't re-probe.
 */
export function useJobContentType(
  jobId: string | undefined,
  datasetId: string | undefined,
) {
  return useQuery<string | null>({
    queryKey: jobKeys.contentType(jobId ?? '', datasetId ?? ''),
    queryFn: () => headJobResultContentType(jobId!, datasetId!),
    enabled: !!jobId && !!datasetId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
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

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { runId: string; attemptCount: number }>({
    mutationFn: ({ runId, attemptCount }) => deleteJob(runId, attemptCount),
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
  return useMutation<{ run_id: string }, Error, SubmitFableParams>({
    mutationFn: async ({ fable, name, description, tags, fableId }) => {
      const { blueprint_id, version } = await upsertFable({
        builder: fable,
        display_name: name,
        display_description: description,
        tags,
        parent_id: fableId ?? undefined,
      })

      return executeJob({
        blueprint_id,
        blueprint_version: version,
      })
    },
  })
}
