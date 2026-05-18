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
import type {
  JobExecutionDetail,
  JobExecutionList,
  JobStatus,
} from '@/api/types/job.types'
import { getJobsStatus } from '@/api/endpoints/job'
import { jobKeys } from '@/api/hooks/useJobs'

/** Page size for the run list backing the counts. */
const COUNTS_PAGE_SIZE = 1000

interface JobStatusCounts {
  counts: Record<JobStatus, number>
  total: number
  runs: Array<JobExecutionDetail>
  runningCount: number
  /** Mean progress (0–100) across every running forecast. */
  runningProgress: number
  /** The sole running run's id — for a direct link (null unless exactly one). */
  runningRunId: string | null
}

/** Reduce a run list into per-status counts and aggregate running progress. */
function computeCounts(data: JobExecutionList): JobStatusCounts {
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

  for (const exec of data.runs) {
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

  return {
    counts,
    total,
    runs: data.runs,
    runningCount: counts.running,
    runningProgress:
      counts.running > 0 ? runningProgressSum / counts.running : 0,
    runningRunId: counts.running === 1 ? lastRunningRunId : null,
  }
}

const EMPTY_COUNTS: JobStatusCounts = {
  counts: {
    submitted: 0,
    preparing: 0,
    running: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
  },
  total: 0,
  runs: [],
  runningCount: 0,
  runningProgress: 0,
  runningRunId: null,
}

export function useJobStatusCounts() {
  // Share the run-list query key (and cache entry) with useJobsStatus, and
  // compute the 6 counts in `select` so the reduction runs only when data
  // changes — not on every render.
  const query = useQuery({
    queryKey: jobKeys.list(1, COUNTS_PAGE_SIZE),
    queryFn: () => getJobsStatus(1, COUNTS_PAGE_SIZE),
    select: computeCounts,
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })

  const data = query.data ?? EMPTY_COUNTS

  return {
    ...data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}
