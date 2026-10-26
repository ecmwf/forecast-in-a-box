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
 * Resolve a comparison entry to a browser-reachable WMS base URL.
 *
 * Per source kind:
 *  - `wms`    → immediately running (the capabilities fetch is the health
 *               check downstream)
 *  - `output` → wait for the sink to finish, resolve the GRIB dir from
 *               the marker payload, then ↓
 *  - `path`   → match an already-running lens by `local_path`, else
 *               auto-start one, then poll until running
 *
 * Output entries never reuse a lens started for another run attempt.
 *
 * Idempotency: two panels resolving to the same path must start exactly
 * ONE lens. A module-level in-flight map dedupes concurrent starts across
 * hook instances; a per-instance attempted-set stops effect re-runs (list
 * refetch ticks) from re-firing. Lenses are never auto-stopped on leave —
 * the page offers an explicit "Stop lens servers" action, which flips
 * `autoStart` off so panels don't instantly restart.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  lensFitsOwner,
  lensOwner,
  lensOwnerKey,
  setLensOwner,
} from '../lens-owners'
import type { ComparisonEntry } from '../entry-ref'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import { useJobStatus } from '@/api/hooks/useJobs'
import {
  useLensList,
  useLensStatus,
  useStartSkinnyWms,
} from '@/api/hooks/useLens'
import { buildLensBaseUrl, stopLens } from '@/api/endpoints/lens'
import { ApiClientError } from '@/api/client'
import {
  gribSinkProgress,
  isSinkComplete,
  useStoredDirPath,
} from '@/features/executions/outputs/stored-dir'
import { withEcmwfKey } from '@/features/visualise/ecmwf-key'
import { useEcmwfKey } from '@/stores/ecmwfKeyStore'
import { createLogger } from '@/lib/logger'

const log = createLogger('useComparisonSource')

export type ComparisonSourceState =
  | { phase: 'idle' }
  | { phase: 'resolvingDir' }
  /** The run is still writing this sink's files. */
  | { phase: 'waitingForRun'; written: number; total: number }
  | { phase: 'dirError'; error: string; retry: () => void }
  | { phase: 'starting' }
  | {
      phase: 'running'
      baseUrl: string
      /** null for external `wms` sources (no lens involved). */
      lensId: string | null
      localPath: string | null
    }
  | { phase: 'failed'; error: string | null; retry: () => void }
  /** No lens and auto-start suppressed (user stopped the servers). */
  | { phase: 'stopped'; start: () => void }

/** A lens start for one folder; `owner` is null for path entries. */
interface LensStart {
  path: string
  owner: string | null
  promise: Promise<string>
  id?: string
}

/** Lens starts by folder and owner, shared across hook instances. */
const lensStarts = new Map<string, LensStart>()
/** Revivals per lens key for a lens that dies after serving; then ask the user. */
const MAX_AUTO_RESTARTS = 2
const autoRestartsByKey = new Map<string, number>()

function lensStartKey(path: string, owner: string | null): string {
  return `${owner ?? ''}\n${path}`
}

function ensureLensStarted(
  path: string,
  owner: string | null,
  start: (p: string) => Promise<string>,
): Promise<string> {
  // A sibling's start for this folder fits unless it belongs to another run.
  for (const existing of lensStarts.values()) {
    if (
      existing.path === path &&
      (existing.owner === null || owner === null || existing.owner === owner)
    ) {
      return existing.promise
    }
  }
  // Resolved promises stay cached: a sibling panel resolving its dir just
  // after the start completes must adopt this lens, not start a second one
  // (the 5 s lens-list poll lags). Failures and vanished lenses evict.
  const key = lensStartKey(path, owner)
  const lensStart: LensStart = {
    path,
    owner,
    promise: start(path).then(
      (id) => {
        lensStart.id = id
        if (owner !== null) setLensOwner(id, owner)
        return id
      },
      (err: unknown) => {
        lensStarts.delete(key)
        throw err
      },
    ),
  }
  lensStarts.set(key, lensStart)
  return lensStart.promise
}

/** Evict only the start that died; a sibling's fresh start survives. */
function evictLensStart(goneLensId: string): void {
  for (const [key, lensStart] of lensStarts) {
    if (lensStart.id === goneLensId) lensStarts.delete(key)
  }
}

function pickMatchedLens(
  lenses: ReadonlyArray<LensInstanceDetailResponse> | undefined,
  localPath: string | null,
  owner: string | null,
): LensInstanceDetailResponse | undefined {
  if (!lenses || !localPath) return undefined
  const candidates = lenses.filter(
    (l) =>
      l.lens_params.local_path === localPath &&
      (l.status === 'running' || l.status === 'starting') &&
      lensFitsOwner(l.lens_instance_id, owner),
  )
  return candidates.find((l) => l.status === 'running') ?? candidates[0]
}

export function useComparisonSource(
  entry: ComparisonEntry | null,
  options: { autoStart: boolean },
): ComparisonSourceState {
  const { autoStart } = options
  const isOutput = entry?.kind === 'output'
  const ecmwfKey = useEcmwfKey()

  // 0) Output entries wait until their sink has written every file.
  const runQuery = useJobStatus(isOutput ? entry.jobId : undefined)
  const run = runQuery.data
  const progress =
    isOutput && run ? gribSinkProgress(run.outputs, entry.blockId) : null
  // An unreadable run doesn't hold the entry back; the dir lookup reports it.
  const sinkReady =
    !isOutput ||
    runQuery.isError ||
    (!!run && !!progress && isSinkComplete(progress, run.status))
  const owner =
    isOutput && run ? lensOwnerKey(entry.jobId, run.attempt_count) : null

  // 1) Resolve the directory (output entries only; a path IS the dir).
  const dirQuery = useStoredDirPath(
    isOutput ? entry.jobId : '',
    isOutput ? entry.taskId : '',
    isOutput,
  )
  const localPath =
    entry?.kind === 'path'
      ? entry.path
      : isOutput
        ? (dirQuery.data ?? null)
        : null
  const lensKey = localPath ? lensStartKey(localPath, owner) : null

  // 2) Match a lens that already serves this path (page-wide 5 s poll).
  const lensListQuery = useLensList()
  const matched = pickMatchedLens(lensListQuery.data, localPath, owner)

  // 3) Auto-start when nothing matches. Start state is key-scoped so a
  // slot swap's stale outcome can't fail or shadow the new entry's source.
  const startMutation = useStartSkinnyWms()
  const [started, setStarted] = useState<{ key: string; id: string } | null>(
    null,
  )
  const [startFailure, setStartFailure] = useState<{
    key: string
    error: string
  } | null>(null)
  const startedLensId = started?.key === lensKey ? started.id : null
  const startError = startFailure?.key === lensKey ? startFailure.error : null
  const attemptedKeysRef = useRef<Set<string>>(new Set())

  const startForPath = useCallback(
    (path: string, lensOwnerId: string | null) => {
      const key = lensStartKey(path, lensOwnerId)
      attemptedKeysRef.current.add(key)
      setStartFailure(null)
      ensureLensStarted(path, lensOwnerId, (p) =>
        startMutation.mutateAsync({ localPath: p }),
      ).then(
        (id) => setStarted({ key, id }),
        (err: unknown) =>
          setStartFailure({
            key,
            error: err instanceof Error ? err.message : String(err),
          }),
      )
    },
    [startMutation],
  )

  useEffect(() => {
    if (!entry || entry.kind === 'wms') return
    if (!autoStart || !localPath || !lensKey || !sinkReady) return
    if (matched || startedLensId || startError) return
    if (!lensListQuery.isSuccess) return
    if (attemptedKeysRef.current.has(lensKey)) return
    startForPath(localPath, owner)
  }, [
    entry,
    autoStart,
    localPath,
    lensKey,
    owner,
    sinkReady,
    matched,
    startedLensId,
    startError,
    lensListQuery.isSuccess,
    startForPath,
  ])

  // 4) Poll the owned/matched instance (1 s while starting).
  const lensId = matched?.lens_instance_id ?? startedLensId ?? undefined
  const statusQuery = useLensStatus(entry?.kind === 'wms' ? undefined : lensId)
  const detail = statusQuery.data ?? matched

  // Claim an adopted lens of unknown origin for this run attempt.
  useEffect(() => {
    if (owner !== null && lensId && sinkReady && !lensOwner(lensId)) {
      setLensOwner(lensId, owner)
    }
  }, [owner, lensId, sinkReady])

  // A 404 on the status poll means the instance vanished (stopped from
  // this page or elsewhere) — that's "gone", not "failed". The backend
  // may instead keep the record with status `failed`/`terminated` after
  // an external stop: a lens that already SERVED counts as gone too,
  // while one that never served keeps the honest failed phase (no
  // crash-looping a broken directory).
  const servedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (startedLensId && statusQuery.data?.status === 'running') {
      servedIdsRef.current.add(startedLensId)
    }
  }, [startedLensId, statusQuery.data?.status])
  const diedAfterServing =
    !!startedLensId &&
    servedIdsRef.current.has(startedLensId) &&
    (statusQuery.data?.status === 'failed' ||
      statusQuery.data?.status === 'terminated')
  const statusGone =
    (statusQuery.isError &&
      statusQuery.error instanceof ApiClientError &&
      statusQuery.error.status === 404) ||
    diedAfterServing
  const [restartsExhausted, setRestartsExhausted] = useState(false)
  useEffect(() => {
    if (!statusGone || !startedLensId) return
    if (diedAfterServing && lensKey) {
      const restarts = (autoRestartsByKey.get(lensKey) ?? 0) + 1
      autoRestartsByKey.set(lensKey, restarts)
      if (restarts > MAX_AUTO_RESTARTS) {
        // Keeps crashing after serving: stop reviving it, show Failed.
        setRestartsExhausted(true)
        return
      }
    }
    servedIdsRef.current.delete(startedLensId)
    setStarted(null)
    if (lensKey) attemptedKeysRef.current.delete(lensKey)
    evictLensStart(startedLensId)
    if (diedAfterServing) {
      // Purge the failed record — the registry keeps it otherwise, and a
      // corpse sharing the revived lens's path reads as a duplicate.
      stopLens(startedLensId).catch((err: unknown) =>
        log.debug('Failed to purge dead lens record', { error: err }),
      )
    }
  }, [statusGone, diedAfterServing, startedLensId, lensKey])

  const retry = useCallback(() => {
    setRestartsExhausted(false)
    if (lensKey) {
      autoRestartsByKey.delete(lensKey)
      attemptedKeysRef.current.delete(lensKey)
    }
    // Evict only the instance we know failed — rejected starts already
    // self-evict, and a blanket evict could clobber a sibling's fresh
    // in-flight start and spawn a duplicate server.
    if (startedLensId) evictLensStart(startedLensId)
    setStarted(null)
    setStartFailure(null)
  }, [lensKey, startedLensId])

  // -------- Phase derivation --------

  if (!entry) return { phase: 'idle' }
  if (entry.kind === 'wms') {
    return {
      phase: 'running',
      baseUrl: withEcmwfKey(entry.url, ecmwfKey),
      lensId: null,
      localPath: null,
    }
  }
  if (isOutput && dirQuery.isError) {
    return {
      phase: 'dirError',
      error: dirQuery.error.message,
      retry: () => void dirQuery.refetch(),
    }
  }
  if (!sinkReady) {
    return progress
      ? {
          phase: 'waitingForRun',
          written: progress.written,
          total: progress.total,
        }
      : { phase: 'resolvingDir' }
  }
  if (!localPath) return { phase: 'resolvingDir' }

  // An error atop last-known-running keeps serving — death is 404/terminal.
  const terminal =
    restartsExhausted ||
    startError !== null ||
    (!!lensId &&
      statusQuery.isError &&
      !statusGone &&
      statusQuery.data?.status !== 'running') ||
    ((detail?.status === 'failed' || detail?.status === 'terminated') &&
      !diedAfterServing)
  if (terminal) {
    return {
      phase: 'failed',
      error: startError ?? statusQuery.error?.message ?? null,
      retry,
    }
  }

  // Registry down, no lens in hand — fail with retry, not endless "Starting…".
  if (!lensId && lensListQuery.isError) {
    return {
      phase: 'failed',
      error: lensListQuery.error.message,
      retry: () => void lensListQuery.refetch(),
    }
  }

  if (detail?.status === 'running') {
    return {
      phase: 'running',
      baseUrl: buildLensBaseUrl(detail.lens_instance_id),
      lensId: detail.lens_instance_id,
      localPath,
    }
  }

  // Nothing running/starting and auto-start is off → explicit start.
  if (!autoStart && !lensId && !startMutation.isPending) {
    return { phase: 'stopped', start: () => startForPath(localPath, owner) }
  }
  return { phase: 'starting' }
}
