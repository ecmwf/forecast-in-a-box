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
  ProductToOutputId,
} from '@/api/types/job.types'
import type { JobMetadata } from '@/features/executions/stores/useJobMetadataStore'
import { isTerminalStatus } from '@/api/types/job.types'
import {
  deleteJob,
  executeJob,
  getJobAvailable,
  getJobOutputs,
  getJobStatus,
  getJobsStatus,
  restartJob,
} from '@/api/endpoints/job'
import { upsertFable } from '@/api/endpoints/fable'
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

  return useMutation<JobExecuteResponse, Error, string>({
    mutationFn: restartJob,
    onSuccess: (_data, executionId) => {
      queryClient.invalidateQueries({ queryKey: jobKeys.status(executionId) })
    },
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
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

  return useMutation<{ execution_id: string }, Error, SubmitFableParams>({
    mutationFn: async ({ fable, name, description, tags, fableId }) => {
      // Save or update the fable definition first to get a persisted id/version
      const { id, version } = await upsertFable({
        builder: fable,
        display_name: name,
        display_description: description,
        tags,
        parent_id: fableId ?? undefined,
      })

      // Execute the persisted definition by reference
      return executeJob({
        job_definition_id: id,
        job_definition_version: version,
      })
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
      // Key metadata by execution_id (v2 logical execution identifier)
      addJob(response.execution_id, metadata)
    },
  })
}
