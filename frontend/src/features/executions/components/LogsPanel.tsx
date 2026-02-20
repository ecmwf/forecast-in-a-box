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
 * LogsPanel Component
 *
 * Real-time gateway log viewer with SSE streaming and search filtering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Download, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LogLine } from '@/api/hooks/useGateway'
import type { JobStatus } from '@/api/types/job.types'
import { useGatewayLogs } from '@/api/hooks/useGateway'
import { isTerminalStatus } from '@/api/types/job.types'
import { downloadJobLogs } from '@/api/endpoints/job'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { H3, P } from '@/components/base/typography'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('LogsPanel')

interface LogsPanelProps {
  jobId: string
  status: JobStatus
}

const CONNECTION_STATUS_STYLES = {
  connected: { dot: 'bg-green-500', label: 'logs.connected' },
  connecting: { dot: 'bg-amber-500 animate-pulse', label: 'logs.connecting' },
  disconnected: { dot: 'bg-red-500', label: 'logs.disconnected' },
} as const

function getLogLineColor(text: string): string {
  if (text.includes('[ERROR]')) return 'text-red-500'
  if (text.includes('[WARN]')) return 'text-amber-500'
  if (text.includes('[DEBUG]')) return 'text-muted-foreground'
  return ''
}

export function LogsPanel({ jobId, status }: LogsPanelProps) {
  const { t } = useTranslation('executions')
  const isTerminal = isTerminalStatus(status)
  const { logs, connectionStatus } = useGatewayLogs(!isTerminal)

  const [filter, setFilter] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const filteredLines = useMemo(() => {
    const lines: Array<LogLine> = [...logs]
    if (isTerminal) {
      lines.push({
        id: -1,
        text: t('logs.executionEnded'),
        timestamp: Date.now(),
      })
    }
    if (!filter) return lines
    const lowerFilter = filter.toLowerCase()
    return lines.filter((line) => line.text.toLowerCase().includes(lowerFilter))
  }, [logs, filter, isTerminal, t])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const threshold = 40
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    setIsAtBottom(atBottom)
  }, [])

  useEffect(() => {
    if (!isAtBottom) return
    const el = containerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [filteredLines.length, isAtBottom])

  const jumpToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      setIsAtBottom(true)
    }
  }, [])

  const handleDownloadLogs = useCallback(async () => {
    try {
      const blob = await downloadJobLogs(jobId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs-${jobId}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      log.error('Failed to download logs', { jobId, error: err })
      showToast.error(err instanceof Error ? err.message : String(err))
    }
  }, [jobId])

  const statusStyle = CONNECTION_STATUS_STYLES[connectionStatus]

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <H3 className="text-sm font-semibold">{t('logs.title')}</H3>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', statusStyle.dot)} />
              {t(statusStyle.label)}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={handleDownloadLogs}>
            <Download className="h-3.5 w-3.5" />
            {t('actions.downloadLogs')}
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('logs.searchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="relative">
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="max-h-[400px] overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-sm"
          >
            {filteredLines.length === 0 ? (
              <P className="text-muted-foreground">{t('outputs.noOutputs')}</P>
            ) : (
              filteredLines.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    'leading-relaxed break-all whitespace-pre-wrap',
                    getLogLineColor(line.text),
                  )}
                >
                  {line.text}
                </div>
              ))
            )}
          </div>

          {!isAtBottom && (
            <Button
              size="sm"
              variant="outline"
              className="absolute right-3 bottom-3"
              onClick={jumpToBottom}
            >
              <ArrowDown className="h-3 w-3" />
              {t('logs.jumpToBottom')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
