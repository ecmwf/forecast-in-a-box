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
  JobProgressResponse,
  JobProgressResponses,
  JobStatus,
  ProductToOutputId,
  SubmitJobResponse,
} from '@/api/types/job.types'
import type { JobMetadata } from '@/features/executions/stores/useJobMetadataStore'
import {
  createDefaultEnvironment,
  isTerminalStatus,
} from '@/api/types/job.types'
import {
  deleteJob,
  executeJob,
  getJobAvailable,
  getJobOutputs,
  getJobStatus,
  getJobsStatus,
  restartJob,
} from '@/api/endpoints/job'
import { compileFable } from '@/api/endpoints/fable'
import { useJobMetadataStore } from '@/features/executions/stores/useJobMetadataStore'

export const jobKeys = {
  all: ['jobs'] as const,
  status: (jobId: string) => [...jobKeys.all, 'status', jobId] as const,
  list: (page: number, pageSize: number, status?: JobStatus) =>
    [...jobKeys.all, 'list', page, pageSize, status] as const,
  outputs: (jobId: string) => [...jobKeys.all, 'outputs', jobId] as const,
  available: (jobId: string) => [...jobKeys.all, 'available', jobId] as const,
}

export function useJobStatus(jobId: string | undefined) {
  return useQuery<JobProgressResponse>({
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
  return useQuery<JobProgressResponses>({
    queryKey: jobKeys.list(page, pageSize, status),
    queryFn: () => getJobsStatus(page, pageSize, status),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })
}

export function useJobOutputs(jobId: string | undefined) {
  return useQuery<Array<ProductToOutputId>>({
    queryKey: jobKeys.outputs(jobId ?? ''),
    queryFn: () => getJobOutputs(jobId!),
    enabled: !!jobId,
    staleTime: 30 * 1000,
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

  return useMutation<SubmitJobResponse, Error, string>({
    mutationFn: restartJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all })
    },
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return useMutation<{ deleted_count: number }, Error, string>({
    mutationFn: deleteJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all })
    },
  })
}

interface SubmitFableParams {
  fable: FableBuilderV1
  name: string
  description: string
  tags: Array<string>
  fableId: string | null
  fableName: string
  environment?: EnvironmentSpecification
}

export function useSubmitFable() {
  const addJob = useJobMetadataStore((s) => s.addJob)

  return useMutation<SubmitJobResponse, Error, SubmitFableParams>({
    mutationFn: async ({ fable, environment }) => {
      const cascadeJob = await compileFable(fable)

      const spec = {
        job: cascadeJob as {
          job_type: 'raw_cascade_job'
          job_instance: unknown
        },
        environment: environment ?? createDefaultEnvironment(),
        shared: false,
      }

      return executeJob(spec)
    },
    onSuccess: (response, params) => {
      const metadata: JobMetadata = {
        name: params.name,
        description: params.description,
        tags: params.tags,
        fableId: params.fableId,
        fableName: params.fableName,
        fableSnapshot: params.fable,
        submittedAt: new Date().toISOString(),
      }
      addJob(response.id, metadata)
    },
  })
}
