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
 * ExecutionDetailPage Component
 *
 * Job detail page with status header, execution canvas, and tabbed panels.
 */

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ExecutionCanvas } from './ExecutionCanvas'
import { ExecutionErrorBanner } from './ExecutionErrorBanner'
import { ExecutionStatusHeader } from './ExecutionStatusHeader'
import { LogsPanel } from './LogsPanel'
import { OutputsPanel } from './OutputsPanel'
import { SpecificationPanel } from './SpecificationPanel'
import { showToast } from '@/lib/toast'
import { ApiClientError } from '@/api/client'
import { useBlockCatalogue, useFableRetrieve } from '@/api/hooks/useFable'
import { useDeleteJob, useJobStatus, useRestartJob } from '@/api/hooks/useJobs'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useActivityStore } from '@/stores/activityStore'
import { useUiStore } from '@/stores/uiStore'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('ExecutionDetailPage')

export function ExecutionDetailPage() {
  const { t } = useTranslation('executions')
  const { jobId } = useParams({ from: '/_authenticated/executions/$jobId' })
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('outputs')

  const statusQuery = useJobStatus(jobId)
  const restartMutation = useRestartJob()
  const deleteMutation = useDeleteJob()

  const jobData = statusQuery.data
  const { data: fableData } = useFableRetrieve(jobData?.blueprint_id)

  const layoutMode = useUiStore((state) => state.layoutMode)
  const { data: catalogue } = useBlockCatalogue()

  const handleRestart = () => {
    restartMutation.mutate(
      { runId: jobId, attemptCount: jobData!.attempt_count },
      {
        onSuccess: () => {
          useActivityStore.getState().addTask({
            id: `job:${jobId}`,
            type: 'job',
            label: fableData?.display_name ?? `Job ${jobId.slice(0, 8)}`,
            description: `Restarting (attempt ${jobData!.attempt_count + 1})`,
            status: 'active',
            startedAt: Date.now(),
            navigateTo: `/executions/${jobId}`,
          })
          showToast.success(t('actions.restartJob'))
        },
        onError: (error) => {
          log.error('Failed to restart job', { jobId, error })
          showToast.error(error.message)
        },
      },
    )
  }

  const handleDelete = () => {
    deleteMutation.mutate(
      { runId: jobId, attemptCount: jobData!.attempt_count },
      {
        onSuccess: () => {
          showToast.success(t('actions.deleteJob'))
          navigate({ to: '/executions' })
        },
        onError: (error) => {
          log.error('Failed to delete job', { jobId, error })
          showToast.error(error.message)
        },
      },
    )
  }

  const handleEditConfig = () => {
    if (!jobData?.blueprint_id) return
    navigate({
      to: '/configure',
      search: { fableId: jobData.blueprint_id },
    })
  }

  if (statusQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (statusQuery.isError) {
    const is404 =
      statusQuery.error instanceof ApiClientError &&
      statusQuery.error.status === 404

    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 text-center">
        <P className="text-muted-foreground">
          {is404
            ? t('errors.jobNotFoundDescription')
            : statusQuery.error.message}
        </P>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/executions" />}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('errors.backToExecutions')}
        </Button>
      </div>
    )
  }

  if (!jobData) return null

  const jobName = fableData?.display_name ?? t('detail.untitledJob')
  const canEditConfig = !!jobData.blueprint_id

  return (
    <div
      className={cn(
        'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        nativeButton={false}
        render={<Link to="/executions" />}
      >
        <ArrowLeft className="h-4 w-4" />
        {t('detail.backLink')}
      </Button>

      <ExecutionStatusHeader
        jobId={jobId}
        name={jobName}
        description={fableData?.display_description ?? undefined}
        status={jobData.status}
        progress={jobData.progress ?? '0'}
        createdAt={jobData.created_at}
        error={jobData.error}
        onRestart={handleRestart}
        onDelete={handleDelete}
        isRestartPending={restartMutation.isPending}
        isDeletePending={deleteMutation.isPending}
      />

      {jobData.status === 'failed' && jobData.error && (
        <ExecutionErrorBanner
          error={jobData.error}
          jobId={jobId}
          onRestart={handleRestart}
          onEditConfig={handleEditConfig}
          canEditConfig={canEditConfig}
        />
      )}

      {fableData?.builder && catalogue ? (
        <ExecutionCanvas
          fable={fableData.builder}
          catalogue={catalogue}
          status={jobData.status}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <P className="font-medium text-muted-foreground">
            {t('detail.graphUnavailable')}
          </P>
          <P className="text-muted-foreground">
            {t('detail.graphUnavailableDescription')}
          </P>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="outputs">{t('tabs.outputs')}</TabsTrigger>
          <TabsTrigger value="logs">{t('tabs.logs')}</TabsTrigger>
          <TabsTrigger value="specification">
            {t('tabs.specification')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="outputs">
          <OutputsPanel
            jobId={jobId}
            status={jobData.status}
            outputs={jobData.outputs}
          />
        </TabsContent>
        <TabsContent value="logs">
          <LogsPanel jobId={jobId} status={jobData.status} />
        </TabsContent>
        <TabsContent value="specification">
          <SpecificationPanel fableSnapshot={fableData?.builder} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
