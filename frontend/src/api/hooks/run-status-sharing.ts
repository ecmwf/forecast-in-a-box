/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A busy gateway (e.g. stopping a run) reads active runs as `unknown`; keep their last status. */

import { replaceEqualDeep } from '@tanstack/react-query'
import type { JobStatus } from '@/api/types/job.types'
import { isTerminalStatus } from '@/api/types/job.types'

interface RunStatusRow {
  run_id: string
  attempt_count: number
  status: JobStatus
}

export function keepKnownStatus<T extends RunStatusRow>(
  prev: T | undefined,
  next: T,
): T {
  const transient =
    next.status === 'unknown' &&
    prev !== undefined &&
    prev.run_id === next.run_id &&
    prev.attempt_count === next.attempt_count &&
    prev.status !== 'unknown' &&
    !isTerminalStatus(prev.status)
  return transient ? { ...next, status: prev.status } : next
}

function isRun(value: unknown): value is RunStatusRow {
  return typeof value === 'object' && value !== null && 'status' in value
}

function isRunList(value: unknown): value is { runs: Array<RunStatusRow> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { runs?: unknown }).runs)
  )
}

// TanStack also shares each `select` output this way; other shapes merge as usual.

/** `structuralSharing` for a single run's query. */
export function shareRunDetail(prev: unknown, next: unknown): unknown {
  if (!isRun(next)) return replaceEqualDeep(prev, next)
  return replaceEqualDeep(
    prev,
    keepKnownStatus(isRun(prev) ? prev : undefined, next),
  )
}

/** `structuralSharing` for run lists, matched by run id. */
export function shareRunList(prev: unknown, next: unknown): unknown {
  if (!isRunList(prev) || !isRunList(next)) return replaceEqualDeep(prev, next)
  const byId = new Map(prev.runs.map((run) => [run.run_id, run]))
  return replaceEqualDeep(prev, {
    ...next,
    runs: next.runs.map((run) => keepKnownStatus(byId.get(run.run_id), run)),
  })
}
