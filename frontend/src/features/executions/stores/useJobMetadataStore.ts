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
 * Job Metadata Store
 *
 * Client-side persisted store for job metadata (name, description, tags, fable snapshot).
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

export interface JobMetadata {
  name: string
  description: string
  tags: Array<string>
  fableId: string | null
  fableName: string
  fableSnapshot: FableBuilderV1
  submittedAt: string
}

interface JobMetadataState {
  jobs: Record<string, JobMetadata>
  addJob: (jobId: string, metadata: JobMetadata) => void
  updateJob: (
    jobId: string,
    patch: Partial<Pick<JobMetadata, 'name' | 'description' | 'tags'>>,
  ) => void
  removeJob: (jobId: string) => void
  getJob: (jobId: string) => JobMetadata | undefined
}

export const useJobMetadataStore = create<JobMetadataState>()(
  devtools(
    persist(
      (set, get) => ({
        jobs: {},

        addJob: (jobId, metadata) =>
          set(
            (state) => ({
              jobs: { ...state.jobs, [jobId]: metadata },
            }),
            false,
            'addJob',
          ),

        updateJob: (jobId, patch) =>
          set(
            (state) => ({
              jobs: {
                ...state.jobs,
                [jobId]: { ...state.jobs[jobId], ...patch },
              },
            }),
            false,
            'updateJob',
          ),

        removeJob: (jobId) =>
          set(
            (state) => {
              const { [jobId]: _, ...rest } = state.jobs
              return { jobs: rest }
            },
            false,
            'removeJob',
          ),

        getJob: (jobId) => get().jobs[jobId],
      }),
      {
        name: STORAGE_KEYS.stores.jobMetadata,
        version: STORE_VERSIONS.jobMetadata,
      },
    ),
    { name: 'JobMetadataStore' },
  ),
)
