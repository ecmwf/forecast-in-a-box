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
 * RunErrorBanner Component
 *
 * Error banner with actions to download logs, restart, or edit configuration.
 */

import { useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  RotateCcw,
  Settings,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { downloadJobLogs } from '@/api/endpoints/job'
import { createLogger } from '@/lib/logger'
import { downloadBlob } from '@/lib/download-blob'
import { showToast } from '@/lib/toast'
import { cn, copyToClipboard } from '@/lib/utils'

const log = createLogger('RunErrorBanner')

interface RunErrorBannerProps {
  error: string
  jobId: string
  onRestart: () => void
  onEditConfig: () => void
  canEditConfig: boolean
}

// Collapse tracebacks past this size so the banner doesn't dominate the page.
const COLLAPSE_LINES = 6
const COLLAPSE_CHARS = 600

export function RunErrorBanner({
  error,
  jobId,
  onRestart,
  onEditConfig,
  canEditConfig,
}: RunErrorBannerProps) {
  const { t } = useTranslation('executions')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const collapsible =
    error.split('\n').length > COLLAPSE_LINES || error.length > COLLAPSE_CHARS

  const handleCopy = async () => {
    const ok = await copyToClipboard(error)
    if (!ok) {
      showToast.error(t('errors.copyFailed'))
      return
    }
    setCopied(true)
    clearTimeout(copyResetRef.current)
    copyResetRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadLogs = async () => {
    try {
      const blob = await downloadJobLogs(jobId)
      downloadBlob(blob, `job-${jobId}-logs.zip`)
    } catch (err) {
      log.error('Failed to download logs', { jobId, error: err })
      showToast.error(
        err instanceof Error ? err.message : t('actions.downloadLogsFailed'),
      )
    }
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{t('errors.executionFailed')}</AlertTitle>
      <AlertDescription>
        <div className="relative mb-1 w-full">
          <pre
            className={cn(
              'w-full rounded-md bg-destructive/5 p-3 pr-20 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap',
              collapsible && !expanded && 'max-h-40 overflow-hidden',
              collapsible && expanded && 'max-h-96 overflow-auto',
            )}
          >
            {error}
          </pre>
          {collapsible && !expanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-md bg-gradient-to-t from-background to-transparent" />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="absolute top-2 right-2 h-7 gap-1.5"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t('errors.copied') : t('errors.copy')}
          </Button>
        </div>
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((prev) => !prev)}
            className="mb-2 h-7 gap-1 px-2"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {expanded ? t('errors.showLess') : t('errors.showFull')}
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadLogs}>
            <Download className="mr-1.5 h-4 w-4" />
            {t('actions.downloadLogs')}
          </Button>
          <Button variant="outline" size="sm" onClick={onRestart}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            {t('actions.restartJob')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onEditConfig}
            disabled={!canEditConfig}
          >
            <Settings className="mr-1.5 h-4 w-4" />
            {t('actions.editConfiguration')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
