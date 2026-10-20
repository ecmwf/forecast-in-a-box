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
import { GRIB_DIR_MIME } from './adapters/grib'
import type { JobStatus, RunOutputs } from '@/api/types/job.types'
import { getJobResultHead } from '@/api/endpoints/job'
import { isTerminalStatus } from '@/api/types/job.types'

/** The directory payload is a short path — cap the fetch defensively. */
const DIR_PAYLOAD_BYTES = 1024

/** Marker tasks of one GRIB sink, from run metadata: finished and expected. */
export interface SinkProgress {
  written: number
  total: number
}

export function gribSinkProgress(
  outputs: RunOutputs | null | undefined,
  blockId: string,
): SinkProgress {
  let written = 0
  let total = 0
  for (const meta of Object.values(outputs ?? {})) {
    if (meta.mime_type !== GRIB_DIR_MIME || meta.original_block !== blockId) {
      continue
    }
    total += 1
    if (meta.is_available) written += 1
  }
  return { written, total }
}

/** Every marker task finished, or the run has ended; no file access. */
export function isSinkComplete(
  progress: SinkProgress,
  status: JobStatus,
): boolean {
  return progress.written === progress.total || isTerminalStatus(status)
}

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
