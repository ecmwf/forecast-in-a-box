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
 * Resolve the on-disk directory behind a stored-output marker: GribSink
 * streams its (run-private, glyph-resolved) output directory as the
 * marker's payload. Shared queryOptions so StoredOutputsCard, the lens
 * path index, and the compare page all hit one cache entry.
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
import { getJobResultHead } from '@/api/endpoints/job'

/** The directory payload is a short path — cap the fetch defensively. */
const DIR_PAYLOAD_BYTES = 1024

export function storedDirQueryOptions(jobId: string, taskId: string) {
  return queryOptions({
    queryKey: ['job-result', 'stored-dir', jobId, taskId] as const,
    queryFn: async () => {
      const head = await getJobResultHead(jobId, taskId, DIR_PAYLOAD_BYTES)
      return new TextDecoder().decode(head).trim()
    },
    staleTime: Infinity,
    retry: 1,
  })
}

export function useStoredDirPath(
  jobId: string,
  taskId: string,
  enabled: boolean,
) {
  return useQuery({ ...storedDirQueryOptions(jobId, taskId), enabled })
}
