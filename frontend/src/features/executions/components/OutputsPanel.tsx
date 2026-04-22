/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useRef } from 'react'
import { Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { JobStatus } from '@/api/types/job.types'
import { isTerminalStatus } from '@/api/types/job.types'
import { jobKeys, useJobAvailable } from '@/api/hooks/useJobs'
import { OutputCard } from '@/features/executions/components/OutputCard'
import { P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'

interface OutputsPanelProps {
  jobId: string
  status: JobStatus
}

export function OutputsPanel({ jobId, status }: OutputsPanelProps) {
  const { t } = useTranslation('executions')
  const { data: availableIds } = useJobAvailable(jobId, status)
  const queryClient = useQueryClient()

  // The polling loop stops the moment status turns terminal, so the last
  // poll can still be an empty list if outputs hadn't been published yet.
  // Force a final refetch on the transition so the user doesn't need to
  // reload the page to see completed outputs.
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const wasNonTerminal = !isTerminalStatus(prevStatusRef.current)
    const nowTerminal = isTerminalStatus(status)
    if (wasNonTerminal && nowTerminal) {
      queryClient.invalidateQueries({ queryKey: jobKeys.available(jobId) })
    }
    prevStatusRef.current = status
  }, [status, jobId, queryClient])

  const hasResults = availableIds && availableIds.length > 0
  const isRunning = !isTerminalStatus(status)

  if (!hasResults) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <P className="font-medium text-muted-foreground">
            {t('outputs.noOutputs')}
          </P>
          {isRunning && (
            <P className="text-muted-foreground">
              {t('outputs.noOutputsRunning')}
            </P>
          )}
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 p-6">
        <P className="text-muted-foreground">
          {t('outputs.generated')}: {availableIds.length}
        </P>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {availableIds.map((taskId) => (
            <OutputCard
              key={taskId}
              jobId={jobId}
              taskId={taskId}
              productName={taskId}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}
