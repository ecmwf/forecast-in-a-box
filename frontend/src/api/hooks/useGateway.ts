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
 * Gateway Hooks
 *
 * SSE streaming for gateway logs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getGatewayLogsUrl } from '@/api/endpoints/gateway'

export interface LogLine {
  id: number
  text: string
  timestamp: number
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export function useGatewayLogs(enabled: boolean = true) {
  const [logs, setLogs] = useState<Array<LogLine>>([])
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected')
  const eventSourceRef = useRef<EventSource | null>(null)
  const idCounterRef = useRef(0)

  const clearLogs = useCallback(() => {
    setLogs([])
    idCounterRef.current = 0
  }, [])

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
        setConnectionStatus('disconnected')
      }
      return
    }

    const url = getGatewayLogsUrl()
    setConnectionStatus('connecting')

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setConnectionStatus('connected')
    }

    eventSource.onmessage = (event) => {
      const text = event.data as string
      if (!text) return

      const line: LogLine = {
        id: idCounterRef.current++,
        text,
        timestamp: Date.now(),
      }
      setLogs((prev) => [...prev, line])
    }

    eventSource.onerror = () => {
      setConnectionStatus('disconnected')
      // EventSource auto-reconnects on error
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      setConnectionStatus('disconnected')
    }
  }, [enabled])

  return { logs, connectionStatus, clearLogs }
}
