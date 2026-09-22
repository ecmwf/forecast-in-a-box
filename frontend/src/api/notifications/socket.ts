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
 * Notification WebSocket transport
 *
 * Refcounted singleton to the backend's server-push channel. Messages are
 * cache-invalidation hints with polling as the freshness floor, so a dead
 * socket costs speed, not correctness — failures log, never toast.
 * Reconnects: exponential backoff with jitter, immediate retry on
 * online/tab-visible, resync of registered routes after reopen (no replay).
 * A short release grace absorbs StrictMode remounts.
 */

import type { NotificationConnectionStatus } from '@/stores/notificationStore'
import { API_ENDPOINTS } from '@/api/endpoints'
import {
  handleNotificationSocketMessage,
  resyncRegisteredRoutes,
} from '@/api/notifications/dispatch'
import { createLogger } from '@/lib/logger'
import { useNotificationStore } from '@/stores/notificationStore'

const log = createLogger('NotificationSocket')

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
/** An open connection must live this long before the backoff resets. */
const BACKOFF_RESET_AFTER_MS = 10_000
/** Grace before closing when the last consumer releases (StrictMode remount). */
const RELEASE_GRACE_MS = 250

let refCount = 0
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let backoffResetTimer: ReturnType<typeof setTimeout> | null = null
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let attempt = 0
let everOpened = false

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${API_ENDPOINTS.notification.ws}`
}

function setStatus(status: NotificationConnectionStatus): void {
  useNotificationStore.getState().setStatus(status)
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer !== null) clearTimeout(timer)
  return null
}

function connect(): void {
  if (socket !== null || refCount === 0) return
  reconnectTimer = clearTimer(reconnectTimer)
  // Reconnects keep their 'degraded' status until the socket actually opens
  if (!everOpened) setStatus('connecting')

  const ws = new WebSocket(socketUrl())
  socket = ws

  ws.addEventListener('open', () => {
    if (socket !== ws) return
    log.debug('Connected')
    setStatus('connected')
    // Gap events are lost — refetch everything push-driven
    if (everOpened) resyncRegisteredRoutes()
    everOpened = true
    backoffResetTimer = setTimeout(() => {
      attempt = 0
    }, BACKOFF_RESET_AFTER_MS)
  })

  ws.addEventListener('message', (event) => {
    if (socket !== ws) return
    handleNotificationSocketMessage(event.data)
  })

  ws.addEventListener('close', () => {
    if (socket !== ws) return
    socket = null
    backoffResetTimer = clearTimer(backoffResetTimer)
    if (refCount === 0) {
      setStatus('idle')
      return
    }
    setStatus('degraded')
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return
  const base = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** attempt)
  const delay = base * (0.5 + Math.random() * 0.5)
  attempt += 1
  log.debug('Reconnecting', { inMs: Math.round(delay), attempt })
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

/** Skip any pending backoff — used when the network/tab plausibly recovered. */
function reconnectNow(): void {
  if (refCount === 0 || socket !== null) return
  reconnectTimer = clearTimer(reconnectTimer)
  connect()
}

function handleOnline(): void {
  reconnectNow()
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') reconnectNow()
}

function teardown(): void {
  releaseTimer = null
  if (refCount > 0) return
  window.removeEventListener('online', handleOnline)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  reconnectTimer = clearTimer(reconnectTimer)
  backoffResetTimer = clearTimer(backoffResetTimer)
  attempt = 0
  everOpened = false
  const ws = socket
  socket = null // detach first so the close listener no-ops
  ws?.close()
  setStatus('idle')
}

/** Keep the singleton alive; the returned release closes it shortly after the last consumer lets go. */
export function acquireNotificationSocket(): () => void {
  refCount += 1
  releaseTimer = clearTimer(releaseTimer)
  if (refCount === 1) {
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    connect()
  }

  let released = false
  return () => {
    if (released) return
    released = true
    refCount -= 1
    if (refCount === 0) {
      releaseTimer = setTimeout(teardown, RELEASE_GRACE_MS)
    }
  }
}

/** Test-only: tear down the singleton regardless of refcount. */
export function resetNotificationSocketForTests(): void {
  refCount = 0
  releaseTimer = clearTimer(releaseTimer)
  teardown()
}
