/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useQueries } from '@tanstack/react-query'
import type { JobExecutionDetail } from '@/api/types/job.types'
import { jobKeys } from '@/api/hooks/useJobs'
import { getJobStatus } from '@/api/endpoints/job'

/** A run's attempts, all or the `latest` few; `enabled` gates fetching. */
export function useRunAttempts(
  runId: string,
  attemptCount: number,
  enabled: boolean,
  latest?: number,
): Array<JobExecutionDetail> {
  const first = latest ? Math.max(1, attemptCount - latest + 1) : 1
  const numbers = enabled
    ? Array.from(
        { length: attemptCount - first + 1 },
        (_, index) => first + index,
      )
    : []

  return useQueries({
    queries: numbers.map((attempt) => ({
      queryKey: [...jobKeys.status(runId), 'attempt', attempt],
      queryFn: () => getJobStatus(runId, attempt),
      staleTime: 30_000,
    })),
    combine: (results) =>
      results.flatMap((result) => (result.data ? [result.data] : [])),
  })
}
