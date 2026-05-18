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
 * Shared TanStack Query layer for output blobs.
 *
 * The same output is consumed by several views at once — a thumbnail, the
 * full viewer, and the download / copy actions. A bare `getJobResult` fetch
 * pulled the payload once per consumer; routing every consumer through one
 * query key collapses that to a single download, cached for reuse.
 *
 * The MIME sniffer needs only the leading magic bytes, never the whole file,
 * so it gets its own `Range`-bounded query key.
 */

import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { getJobResult, getJobResultHead } from '@/api/endpoints/job'

interface JobResult {
  blob: Blob
  contentType: string
}

export const jobResultKeys = {
  all: ['job-result'] as const,
  blob: (jobId: string, taskId: string) =>
    [...jobResultKeys.all, 'blob', jobId, taskId] as const,
  head: (jobId: string, taskId: string, byteCount: number) =>
    [...jobResultKeys.all, 'head', jobId, taskId, byteCount] as const,
}

// Output blobs are immutable once produced — a task id is written exactly
// once. Keep them fresh for the session so a re-mounted viewer or thumbnail
// reuses the cached payload instead of re-downloading.
const BLOB_STALE_TIME = Infinity
const BLOB_GC_TIME = 30 * 60 * 1000
// No retry — the body can be a multi-gigabyte payload; a transient failure
// should surface at once, not trigger several large re-downloads.
const BLOB_RETRY = 0

/**
 * Subscribe to an output blob. Use from a component (viewer, thumbnail);
 * concurrent consumers of the same task id share one in-flight fetch and one
 * cache entry.
 */
export function useJobResultBlob(
  jobId: string,
  taskId: string,
  enabled = true,
) {
  return useQuery<JobResult>({
    queryKey: jobResultKeys.blob(jobId, taskId),
    queryFn: () => getJobResult(jobId, taskId),
    enabled,
    staleTime: BLOB_STALE_TIME,
    gcTime: BLOB_GC_TIME,
    retry: BLOB_RETRY,
    refetchOnWindowFocus: false,
  })
}

/**
 * Imperatively resolve an output blob through the shared cache. For
 * non-component call sites (download / copy actions) — returns the cached
 * entry when one exists, otherwise fetches and populates it.
 */
export function fetchJobResultBlob(
  queryClient: QueryClient,
  jobId: string,
  taskId: string,
): Promise<JobResult> {
  return queryClient.fetchQuery<JobResult>({
    queryKey: jobResultKeys.blob(jobId, taskId),
    queryFn: () => getJobResult(jobId, taskId),
    staleTime: BLOB_STALE_TIME,
    gcTime: BLOB_GC_TIME,
    retry: BLOB_RETRY,
  })
}

/**
 * Imperatively resolve the leading `byteCount` bytes of an output for MIME
 * sniffing, deduplicated through the shared cache. Avoids downloading the
 * whole payload just to read a handful of magic bytes.
 */
export function fetchJobResultHead(
  queryClient: QueryClient,
  jobId: string,
  taskId: string,
  byteCount: number,
): Promise<Uint8Array> {
  return queryClient.fetchQuery<Uint8Array>({
    queryKey: jobResultKeys.head(jobId, taskId, byteCount),
    queryFn: () => getJobResultHead(jobId, taskId, byteCount),
    staleTime: BLOB_STALE_TIME,
    gcTime: BLOB_GC_TIME,
    retry: BLOB_RETRY,
  })
}
