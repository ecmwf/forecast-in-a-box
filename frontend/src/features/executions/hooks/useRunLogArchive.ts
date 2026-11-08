/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useQuery } from '@tanstack/react-query'
import type { LogArchive } from '@/features/executions/utils/run-logs'
import { downloadJobLogs } from '@/api/endpoints/job'
import { jobKeys } from '@/api/hooks/useJobs'
import { unpackLogArchive } from '@/features/executions/utils/run-logs'

export interface RunLogArchive extends LogArchive {
  /** The zip as served. */
  blob: Blob
  fetchedAt: number
}

/** The run's log archive; no polling, refetched on demand. */
export function useRunLogArchive(runId: string) {
  return useQuery<RunLogArchive>({
    queryKey: jobKeys.logs(runId),
    queryFn: async () => {
      const blob = await downloadJobLogs(runId)
      const archive = unpackLogArchive(new Uint8Array(await blob.arrayBuffer()))
      return { ...archive, blob, fetchedAt: Date.now() }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
}
