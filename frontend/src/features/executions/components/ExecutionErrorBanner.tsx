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
 * ExecutionErrorBanner Component
 *
 * Error banner with actions to download logs, restart, or edit configuration.
 */

import { AlertCircle, Download, RotateCcw, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { P } from '@/components/base/typography'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { downloadJobLogs } from '@/api/endpoints/job'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('ExecutionErrorBanner')

interface ExecutionErrorBannerProps {
  error: string
  jobId: string
  onRestart: () => void
  onEditConfig: () => void
  canEditConfig: boolean
}

export function ExecutionErrorBanner({
  error,
  jobId,
  onRestart,
  onEditConfig,
  canEditConfig,
}: ExecutionErrorBannerProps) {
  const { t } = useTranslation('executions')

  const handleDownloadLogs = async () => {
    try {
      const blob = await downloadJobLogs(jobId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `job-${jobId}-logs.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      log.error('Failed to download logs', { jobId, error: err })
      showToast.error(
        err instanceof Error ? err.message : 'Failed to download logs',
      )
    }
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{t('errors.executionFailed')}</AlertTitle>
      <AlertDescription>
        <P className="mb-3">{error}</P>
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
