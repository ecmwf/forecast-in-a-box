/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LogWorkerMessage,
  LogWorkerReply,
  LogWorkerRequest,
  LogWorkerResults,
} from '@/features/executions/utils/log-worker-protocol'
import type { LogSnapshotSummary } from '@/features/executions/utils/log-snapshot'
import { downloadJobLogs } from '@/api/endpoints/job'
import { LogSnapshotStore } from '@/features/executions/utils/log-snapshot'
import { handleLogRequest } from '@/features/executions/utils/log-worker-protocol'

export type LogCall = <T extends LogWorkerRequest>(
  request: T,
) => Promise<LogWorkerResults[T['type']]>

interface LogWorkerClient {
  call: LogCall
  terminate: () => void
}

function createWorkerClient(): LogWorkerClient {
  // Same thread where workers are missing.
  if (typeof Worker === 'undefined') {
    const store = new LogSnapshotStore()
    return {
      call: (request) =>
        Promise.resolve(
          handleLogRequest(store, request)
            .value as LogWorkerResults[(typeof request)['type']],
        ),
      terminate: () => {},
    }
  }
  const worker = new Worker(
    new URL('../workers/run-logs.worker.ts', import.meta.url),
    { type: 'module' },
  )
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let nextId = 0
  worker.onmessage = (event: MessageEvent<LogWorkerReply>) => {
    const reply = event.data
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.ok) waiter.resolve(reply.value)
    else waiter.reject(new Error(reply.error))
  }
  worker.onerror = (event) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(event.message || 'Log worker failed'))
    }
    pending.clear()
  }
  return {
    call: (request) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
        })
        const message: LogWorkerMessage = { id, request }
        const transfer = request.type === 'load' ? [request.zip] : []
        worker.postMessage(message, transfer)
      }),
    terminate: () => worker.terminate(),
  }
}

export interface LogSnapshot extends LogSnapshotSummary {
  fetchedAt: number
  /** The zip as served. */
  blob: Blob
}

/** Line totals of the snapshot before, by file. */
export interface PreviousSnapshot {
  fetchedAt: number
  totals: ReadonlyMap<string, number>
}

/** A run's logs as one snapshot, fetched only on `load`; the worker lives as long as the caller. */
export function useLogSnapshot(runId: string) {
  const clientRef = useRef<LogWorkerClient | null>(null)
  const [snapshot, setSnapshot] = useState<LogSnapshot | null>(null)
  const [previous, setPrevious] = useState<PreviousSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const loadsRef = useRef(0)
  const snapshotRef = useRef<LogSnapshot | null>(null)

  useEffect(
    () => () => {
      clientRef.current?.terminate()
      clientRef.current = null
    },
    [],
  )

  const call = useCallback<LogCall>((request) => {
    clientRef.current ??= createWorkerClient()
    return clientRef.current.call(request)
  }, [])

  // One load at a time: the worker keeps the last archive it was sent.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const load = useCallback((): Promise<LogSnapshot | null> => {
    const ticket = ++loadsRef.current
    setIsLoading(true)
    setError(null)
    const run = async (): Promise<LogSnapshot | null> => {
      try {
        const blob = await downloadJobLogs(runId)
        const fetchedAt = Date.now()
        const summary = await call({
          type: 'load',
          zip: await blob.arrayBuffer(),
        })
        if (ticket !== loadsRef.current) return null
        const next = { ...summary, fetchedAt, blob }
        const before = snapshotRef.current
        setPrevious(
          before && {
            fetchedAt: before.fetchedAt,
            totals: new Map(before.files.map((f) => [f.name, f.totalLines])),
          },
        )
        snapshotRef.current = next
        setSnapshot(next)
        return next
      } catch (caught) {
        if (ticket === loadsRef.current) {
          setError(caught instanceof Error ? caught : new Error(String(caught)))
        }
        return null
      } finally {
        if (ticket === loadsRef.current) setIsLoading(false)
      }
    }
    const next = queueRef.current.then(run, run)
    queueRef.current = next
    return next
  }, [runId, call])

  return { snapshot, previous, isLoading, error, load, call }
}
