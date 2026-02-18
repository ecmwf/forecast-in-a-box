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
 * useEventSource Hook. Currently not used.
 *
 * React hook for Server-Sent Events (SSE) connections.
 * Manages connection lifecycle, reconnection, and event handling.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logger'

const log = createLogger('EventSource')

export interface UseEventSourceOptions {
  /** Whether the connection should be active */
  enabled?: boolean
  /** Reconnection delay in milliseconds (default: 3000) */
  reconnectDelay?: number
  /** Maximum number of reconnection attempts (default: 5) */
  maxReconnectAttempts?: number
  /** Event handlers for specific event types */
  events?: Record<string, (event: MessageEvent) => void>
  /** Handler for all messages (default 'message' event) */
  onMessage?: (event: MessageEvent) => void
  /** Handler for connection open */
  onOpen?: (event: Event) => void
  /** Handler for errors */
  onError?: (event: Event) => void
}

export interface UseEventSourceReturn {
  /** Connection state */
  readyState: number
  /** Last received data (use type guards before accessing properties) */
  data: unknown
  /** Last error */
  error: Event | null
  /** Manual reconnect function */
  reconnect: () => void
  /** Close connection */
  close: () => void
}

/**
 * Hook for Server-Sent Events
 *
 * @param url - SSE endpoint URL
 * @param options - Configuration options
 * @returns EventSource state and controls
 *
 * @example
 * const { data, readyState, error } = useEventSource('/api/v1/jobs/123/events', {
 *   enabled: true,
 *   onMessage: (event) => {
 *     console.log('Received:', event.data)
 *   },
 *   events: {
 *     'progress': (event) => {
 *       const progress = JSON.parse(event.data)
 *       setProgress(progress.value)
 *     }
 *   }
 * })
 */
export function useEventSource(
  url: string,
  options: UseEventSourceOptions = {},
): UseEventSourceReturn {
  const {
    enabled = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
    events = {},
    onMessage,
    onOpen,
    onError,
  } = options

  const [readyState, setReadyState] = useState<number>(EventSource.CLOSED)
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState<Event | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Store handlers in refs to avoid re-creating connection on handler changes
  const handlersRef = useRef({ onMessage, onOpen, onError, events })
  handlersRef.current = { onMessage, onOpen, onError, events }

  const close = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setReadyState(EventSource.CLOSED)
    }
  }, [])

  const connect = useCallback(() => {
    if (!enabled || !url) return

    try {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      // Create new EventSource
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      // Set up event listeners
      eventSource.onopen = (event) => {
        setReadyState(EventSource.OPEN)
        setError(null)
        reconnectAttemptsRef.current = 0
        handlersRef.current.onOpen?.(event)
      }

      eventSource.onerror = (event) => {
        setReadyState(eventSource.readyState)
        setError(event)
        handlersRef.current.onError?.(event)

        // Attempt reconnection
        if (
          eventSource.readyState === EventSource.CLOSED &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          reconnectAttemptsRef.current += 1
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, reconnectDelay)
        }
      }

      // Default message handler
      eventSource.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data)
          setData(parsedData)
        } catch {
          setData(event.data)
        }
        handlersRef.current.onMessage?.(event)
      }

      // Custom event handlers
      Object.entries(handlersRef.current.events).forEach(
        ([eventType, handler]) => {
          eventSource.addEventListener(eventType, handler as EventListener)
        },
      )
    } catch (err) {
      log.error('Failed to create EventSource:', err)
      setError(err as Event)
    }
  }, [url, enabled, maxReconnectAttempts, reconnectDelay])

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0
    close()
    connect()
  }, [close, connect])

  // Set up connection
  useEffect(() => {
    if (enabled && url) {
      connect()
    }

    return close
  }, [url, enabled, connect, close])

  return {
    readyState,
    data,
    error,
    reconnect,
    close,
  }
}
