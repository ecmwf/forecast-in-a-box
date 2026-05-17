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
    preparing: 0,
    running: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
  }

  let total = 0
  let runningProgressSum = 0
  let lastRunningRunId: string | null = null

  if (query.data) {
    for (const exec of query.data.runs) {
      const status = exec.status
      if (status in counts) {
        counts[status]++
      }
      if (status === 'running') {
        const value = parseFloat(exec.progress ?? '') || 0
        runningProgressSum += Math.min(Math.max(value, 0), 100)
        lastRunningRunId = exec.run_id
      }
      total++
    }
  }

  // Mean progress (0–100) across every running forecast.
  const runningProgress =
    counts.running > 0 ? runningProgressSum / counts.running : 0

  return {
    counts,
    total,
    runs: query.data?.runs ?? [],
    runningCount: counts.running,
    runningProgress,
    // The sole running run's id — for a direct link (null unless exactly one).
    runningRunId: counts.running === 1 ? lastRunningRunId : null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}
