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
 * RunDetailPage Component
 *
 * Job detail page with status header, execution canvas, and tabbed panels.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import {
  ArrowLeft,
  FileJson,
  Network,
  Package,
  ScrollText,
  Share2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { RunCanvas } from './RunCanvas'
import { CompilationForceGraph } from './CompilationForceGraph'
import { CompilationPanel } from './CompilationPanel'
import { RunErrorBanner } from './RunErrorBanner'
import { RunStatusHeader } from './RunStatusHeader'
import { LogsPanel } from './LogsPanel'
import { OutputsPanel } from './OutputsPanel'
import { SpecificationPanel } from './SpecificationPanel'
import { StoredOutputsCard } from './StoredOutputsCard'
import { RunMetadataDialog } from '@/features/journal/components/RunMetadataDialog'
import { useExecutionHoverStore } from '@/features/executions/stores/executionHoverStore'
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

const log = createLogger('RunDetailPage')

// Wide-screen layout: each column claims half the row and scrolls
// independently via its TabsContent.
const WIDE_COLUMN =
  'min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-w-0 min-[1280px]:flex-1 min-[1280px]:flex-col'
const WIDE_TAB_CONTENT =
  'min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:overflow-y-auto'

export function RunDetailPage() {
  const { t } = useTranslation('executions')
  const { jobId } = useParams({ from: '/_authenticated/executions/$jobId' })
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('outputs')
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  const handleToolbarRef = useCallback((node: HTMLDivElement | null) => {
    setToolbarSlot(node)
  }, [])

  const statusQuery = useJobStatus(jobId)
  const restartMutation = useRestartJob()
  const deleteMutation = useDeleteJob()

  const jobData = statusQuery.data
  const { data: fableData } = useFableRetrieve(jobData?.blueprint_id)

  // Cross-panel selection is per-run; clear it on mount and on jobId change.
  const resetExecutionSelection = useExecutionHoverStore(
    (state) => state.resetExecutionSelection,
  )
  useEffect(() => {
    resetExecutionSelection()
    return () => resetExecutionSelection()
  }, [jobId, resetExecutionSelection])

  const layoutMode = useUiStore((state) => state.layoutMode)
  const { data: catalogue } = useBlockCatalogue()

  // Sync scroll-to-top before paint — a tall /configure scroll position
  // otherwise clamps into the shorter loading layout and exposes the footer.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [jobId])

  const handleRestart = () => {
    restartMutation.mutate(
      { runId: jobId, attemptCount: jobData!.attempt_count },
      {
        onSuccess: () => {
          useActivityStore.getState().addTask({
            id: `job:${jobId}`,
            type: 'job',
            label:
              fableData?.display_name ??
              t('activity.jobFallbackLabel', { id: jobId.slice(0, 8) }),
            description: t('activity.restarting', {
              attempt: jobData!.attempt_count + 1,
            }),
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
    // min-h-screen (not the loaded state's smaller min) so the spinner area
    // fills the viewport and the navy footer stays below the fold during the
    // submit → detail-page transition.
    return (
      <div
        className={cn(
          'mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:px-6 lg:px-8',
          layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
        )}
      >
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
        // Underscores in arbitrary values emit spaces; `calc(100vh-15rem)`
        // (no spaces) is invalid CSS and silently discarded.
        'mx-auto flex min-h-[calc(100vh_-_15rem)] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      <RunStatusHeader
        jobId={jobId}
        name={jobName}
        description={fableData?.display_description ?? undefined}
        status={jobData.status}
        progress={jobData.progress ?? '0'}
        createdAt={jobData.created_at}
        onRestart={handleRestart}
        onDelete={handleDelete}
        onEditConfig={canEditConfig ? handleEditConfig : undefined}
        onEditMetadata={() => setMetadataOpen(true)}
        isRestartPending={restartMutation.isPending}
        isDeletePending={deleteMutation.isPending}
        completedBlockCount={jobData.completed_block_ids?.length ?? null}
        plannedBlockCount={jobData.planned_block_ids?.length ?? null}
      />

      {jobData.status === 'failed' && jobData.error && (
        <RunErrorBanner
          error={jobData.error}
          jobId={jobId}
          onRestart={handleRestart}
          onEditConfig={handleEditConfig}
          canEditConfig={canEditConfig}
        />
      )}

      {/* Wide: side-by-side, pinned to viewport height with independent
          column scroll. Narrow: stacked single-document scroll. */}
      <div
        className={cn(
          'flex flex-1 flex-col gap-8',
          // Wide: pin to viewport minus chrome (~17rem). flex-none cancels
          // the inherited flex-1 so the explicit height is honoured.
          'min-[1280px]:h-[calc(100vh_-_17rem)] min-[1280px]:flex-row',
          'min-[1280px]:flex-none min-[1280px]:gap-6 min-[1280px]:overflow-hidden',
        )}
      >
        <div className={WIDE_COLUMN}>
          {fableData?.builder && catalogue ? (
            <RunCanvas
              fable={fableData.builder}
              catalogue={catalogue}
              status={jobData.status}
              completedBlockIds={jobData.completed_block_ids}
              plannedBlockIds={jobData.planned_block_ids}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <P className="font-medium text-muted-foreground">
                {t('detail.graphUnavailable')}
              </P>
              <P className="text-muted-foreground">
                {t('detail.graphUnavailableDescription')}
              </P>
            </div>
          )}
        </div>

        <div className={WIDE_COLUMN}>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:flex-col"
          >
            {/* Sticky for the mobile single-scroll layout; no-op at wide.
                Default `bg-muted` is the sticky background — don't override. */}
            <TabsList className="sticky top-0 z-10 grid w-full shrink-0 grid-cols-5">
              <TabsTrigger value="outputs">
                <Package className="h-4 w-4" />
                {t('tabs.outputs')}
              </TabsTrigger>
              <TabsTrigger value="logs">
                <ScrollText className="h-4 w-4" />
                {t('tabs.logs')}
              </TabsTrigger>
              <TabsTrigger value="compilation">
                <Network className="h-4 w-4" />
                {t('tabs.compilation')}
              </TabsTrigger>
              <TabsTrigger value="graph">
                <Share2 className="h-4 w-4" />
                {t('tabs.graph')}
              </TabsTrigger>
              <TabsTrigger value="specification">
                <FileJson className="h-4 w-4" />
                {t('tabs.specification')}
              </TabsTrigger>
            </TabsList>
            <div
              ref={handleToolbarRef}
              className={cn(
                'sticky top-12 z-10 mt-3 flex shrink-0 items-center gap-3 bg-background',
                activeTab !== 'outputs' && 'hidden',
              )}
            />
            <TabsContent
              value="outputs"
              className={cn(WIDE_TAB_CONTENT, 'space-y-4')}
            >
              <OutputsPanel
                jobId={jobId}
                status={jobData.status}
                outputs={jobData.outputs}
                completedBlockIds={jobData.completed_block_ids}
                plannedBlockIds={jobData.planned_block_ids}
                toolbarSlot={toolbarSlot}
              />
              {fableData?.builder && catalogue && (
                <StoredOutputsCard
                  fable={fableData.builder}
                  catalogue={catalogue}
                  storedOutputs={jobData.outputs?.stored}
                />
              )}
            </TabsContent>
            <TabsContent value="logs" className={WIDE_TAB_CONTENT}>
              <LogsPanel jobId={jobId} status={jobData.status} />
            </TabsContent>
            <TabsContent value="compilation" className={WIDE_TAB_CONTENT}>
              <CompilationPanel
                jobId={jobId}
                status={jobData.status}
                fable={fableData?.builder}
                catalogue={catalogue}
                onSwitchTab={setActiveTab}
              />
            </TabsContent>
            <TabsContent value="graph" className={WIDE_TAB_CONTENT}>
              <CompilationForceGraph
                jobId={jobId}
                status={jobData.status}
                fable={fableData?.builder}
                catalogue={catalogue}
              />
            </TabsContent>
            <TabsContent value="specification" className={WIDE_TAB_CONTENT}>
              <SpecificationPanel fableSnapshot={fableData?.builder} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <RunMetadataDialog
        blueprint={fableData}
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
      />
    </div>
  )
}
