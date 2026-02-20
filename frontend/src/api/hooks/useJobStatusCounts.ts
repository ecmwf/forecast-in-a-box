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
 * Hook for computing per-status job counts
 */

import { useQuery } from '@tanstack/react-query'
import type { JobStatus } from '@/api/types/job.types'
import { getJobsStatus } from '@/api/endpoints/job'
import { jobKeys } from '@/api/hooks/useJobs'

export function useJobStatusCounts() {
  const query = useQuery({
    queryKey: [...jobKeys.all, 'counts'] as const,
    queryFn: () => getJobsStatus(1, 1000),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })

  const counts: Record<JobStatus, number> = {
    submitted: 0,
    running: 0,
    completed: 0,
    errored: 0,
    invalid: 0,
    timeout: 0,
    unknown: 0,
  }

  let total = 0

  if (query.data) {
    for (const job of Object.values(query.data.progresses)) {
      counts[job.status]++
      total++
    }
  }

  return {
    counts,
    total,
    runningCount: counts.running,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}
