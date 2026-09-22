/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireNotificationSocket,
  resetNotificationSocketForTests,
} from '@/api/notifications/socket'
import { artifactKeys } from '@/api/hooks/useArtifacts'
import { queryClient } from '@/lib/queryClient'
import { useNotificationStore } from '@/stores/notificationStore'

/** Records instances and lets tests fire open/message/close; never touches the network. */
class FakeWebSocket extends EventTarget {
  static instances: Array<FakeWebSocket> = []
  url: string
  closed = false

  constructor(url: string) {
    super()
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.dispatchEvent(new Event('open'))
  }

  message(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  closeFromServer(): void {
    this.dispatchEvent(new CloseEvent('close'))
  }
}

function status() {
  return useNotificationStore.getState().status
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

describe('notification socket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
    // Kill jitter: backoff factor (0.5 + random * 0.5) becomes exactly 1
    vi.spyOn(Math, 'random').mockReturnValue(1)
  })

  afterEach(() => {
    resetNotificationSocketForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('connects to the notification endpoint on acquire', () => {
    acquireNotificationSocket()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(lastSocket().url).toMatch(/^ws:\/\/.+\/api\/v1\/notification\/ws$/)
    expect(status()).toBe('connecting')
  })

  it('reports connected on open and degraded on close', () => {
    acquireNotificationSocket()
    lastSocket().open()
    expect(status()).toBe('connected')
    lastSocket().closeFromServer()
    expect(status()).toBe('degraded')
  })

  it('dispatches received notifications into query invalidation', () => {
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue()
    acquireNotificationSocket()
    lastSocket().open()
    lastSocket().message(
      JSON.stringify({
        text: 'Artifact model-a finished downloading successfully',
        sourceDomainName: 'artifact',
        sourceDomainEvent: 'artifactDownloadFinished',
        context: {},
        detailRoute: null,
        refreshRoutes: ['api/v1/artifacts/list_models'],
      }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: artifactKeys.list(),
    })
  })

  it('reconnects with growing backoff after repeated closes', () => {
    acquireNotificationSocket()
    lastSocket().open()

    // First drop: reconnect after 1s
    lastSocket().closeFromServer()
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)

    // Second drop without a stable connection in between: 2s
    lastSocket().closeFromServer()
    vi.advanceTimersByTime(1_999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('resets the backoff once a connection stays open', () => {
    acquireNotificationSocket()
    lastSocket().open()
    lastSocket().closeFromServer()
    vi.advanceTimersByTime(1_000) // attempt 1 fires

    // Stays open past the stability window -> attempt counter resets
    lastSocket().open()
    vi.advanceTimersByTime(10_000)

    lastSocket().closeFromServer()
    vi.advanceTimersByTime(1_000) // back to the initial 1s delay
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('resyncs registered routes after a reconnect, not on first open', () => {
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue()
    acquireNotificationSocket()
    lastSocket().open()
    expect(invalidateSpy).not.toHaveBeenCalled()

    lastSocket().closeFromServer()
    vi.advanceTimersByTime(1_000)
    lastSocket().open()
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: artifactKeys.list(),
    })
  })

  it('reconnects immediately when the network comes back online', () => {
    acquireNotificationSocket()
    lastSocket().open()
    lastSocket().closeFromServer()
    // Long backoff pending; online event short-circuits it
    window.dispatchEvent(new Event('online'))
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('survives a StrictMode remount without a second connection', () => {
    const release = acquireNotificationSocket()
    release()
    acquireNotificationSocket()
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(lastSocket().closed).toBe(false)
  })

  it('closes and goes idle after the last release', () => {
    const release = acquireNotificationSocket()
    lastSocket().open()
    release()
    vi.advanceTimersByTime(250)
    expect(lastSocket().closed).toBe(true)
    expect(status()).toBe('idle')

    // No reconnect attempts afterwards
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
