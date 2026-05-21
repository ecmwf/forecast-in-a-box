/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Dagre/swimlane Compilation tab. Static LR layout of the full task DAG;
 * each block becomes a labelled group node, cross-block edges are dashed. */

import { useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import type { Node, NodeMouseHandler } from '@xyflow/react'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { CompilationDetailTask, JobStatus } from '@/api/types/job.types'
import type {
  BlockGroupData,
  TaskNodeData,
} from '@/features/executions/utils/taskDagLayout'
import { ApiClientError } from '@/api/client'
import { getFactory } from '@/api/types/fable.types'
import { useCompilationDetail } from '@/api/hooks/useJobs'
import { CompilationBlockNode } from '@/features/executions/components/CompilationBlockNode'
import { CompilationTaskNode } from '@/features/executions/components/CompilationTaskNode'
import {
  TASK_KIND_META,
  classifyTask,
} from '@/features/executions/utils/taskClassify'
import {
  COMPILATION_BLOCK_NODE_TYPE,
  buildFullTaskGraph,
} from '@/features/executions/utils/taskDagLayout'
import {
  buildLineage,
  lineageUnion,
} from '@/features/executions/utils/taskLineage'
import { humaniseTaskName } from '@/features/executions/utils/taskName'
import { useExecutionHoverStore } from '@/features/executions/stores/executionHoverStore'
import { ExperimentalNotice } from '@/features/executions/components/ExperimentalNotice'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { P } from '@/components/base/typography'

interface CompilationPanelProps {
  jobId: string
  status: JobStatus
  fable: FableBuilderV1 | undefined
  catalogue: BlockFactoryCatalogue | undefined
}

const nodeTypes = {
  compilationTask: CompilationTaskNode,
  [COMPILATION_BLOCK_NODE_TYPE]: CompilationBlockNode,
}

export function CompilationPanel({
  jobId,
  status,
  fable,
  catalogue,
}: CompilationPanelProps) {
  const { t } = useTranslation('executions')
  const query = useCompilationDetail(jobId, status)

  // Block-id → factory title. Falls back to the raw id when the fable
  // doesn't include the block (e.g. blueprint edited after this run).
  const blockLabelFor = useMemo(() => {
    return (blockId: string): string => {
      if (!fable || !catalogue) return blockId
      if (!(blockId in fable.blocks)) return blockId
      return (
        getFactory(catalogue, fable.blocks[blockId].factory_id)?.title ??
        blockId
      )
    }
  }, [fable, catalogue])

  const tasks: ReadonlyArray<CompilationDetailTask> = query.data?.tasks ?? []
  const graph = useMemo(
    () => buildFullTaskGraph(tasks, blockLabelFor),
    [tasks, blockLabelFor],
  )
  const lineage = useMemo(() => buildLineage(tasks), [tasks])
  const taskById = useMemo(() => {
    const map = new Map<string, CompilationDetailTask>()
    for (const task of tasks) map.set(task.task_id, task)
    return map
  }, [tasks])

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)

  // Primitive selectors (per field) — an object-returning selector would
  // mint a new reference each render and loop Zustand's Object.is check.
  const selectedBlockId = useExecutionHoverStore(
    (state) => state.selectedBlockId,
  )
  const setSelectedBlockId = useExecutionHoverStore(
    (state) => state.setSelectedBlockId,
  )

  const anchorId = hoverTaskId ?? selectedTaskId
  const lineageSet = useMemo(() => {
    if (!anchorId) return null
    return lineageUnion(anchorId, lineage)
  }, [anchorId, lineage])

  // Hover lineage wins over block selection when both are present.
  const selectionTaskSet = useMemo(() => {
    if (lineageSet) return lineageSet
    if (!selectedBlockId) return null
    const set = new Set<string>()
    for (const task of tasks) {
      if (task.block === selectedBlockId) set.add(task.task_id)
    }
    return set
  }, [lineageSet, selectedBlockId, tasks])

  const nodes = useMemo<Array<Node<TaskNodeData | BlockGroupData>>>(() => {
    if (!selectionTaskSet) return graph.nodes
    return graph.nodes.map((node) => {
      if (node.type !== 'compilationTask') return node
      return {
        ...node,
        data: {
          ...node.data,
          lineageState: selectionTaskSet.has(node.id)
            ? ('highlighted' as const)
            : ('dimmed' as const),
        },
      }
    })
  }, [graph.nodes, selectionTaskSet])

  const edges = useMemo(() => {
    if (!selectionTaskSet) return graph.edges
    return graph.edges.map((edge) => {
      const lit =
        selectionTaskSet.has(edge.source) && selectionTaskSet.has(edge.target)
      return {
        ...edge,
        style: {
          ...(edge.style ?? {}),
          opacity: lit ? 1 : 0.2,
        },
      }
    })
  }, [graph.edges, selectionTaskSet])

  const handleNodeMouseEnter: NodeMouseHandler = (_event, node) => {
    if (node.type === 'compilationTask') setHoverTaskId(node.id)
  }
  const handleNodeMouseLeave: NodeMouseHandler = () => setHoverTaskId(null)
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.type !== 'compilationTask') return
    const taskData = node.data as TaskNodeData
    setSelectedTaskId((prev) => (prev === node.id ? null : node.id))
    // Task click also focuses its block on the left RunCanvas.
    setSelectedBlockId(
      selectedBlockId === taskData.task.block ? null : taskData.task.block,
    )
  }
  const handlePaneClick = () => {
    setSelectedTaskId(null)
    if (selectedBlockId !== null) setSelectedBlockId(null)
  }

  if (query.isLoading) {
    return (
      <div className="flex h-[480px] items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  const is404 =
    query.isError &&
    query.error instanceof ApiClientError &&
    query.error.status === 404
  if (is404) {
    return (
      <div className="flex h-[480px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
        <P className="font-medium text-muted-foreground">
          {t('compilation.unavailable')}
        </P>
        <P className="text-muted-foreground">
          {t('compilation.unavailableDescription')}
        </P>
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
        {t('compilation.fetchError')}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
        {t('compilation.noTasks')}
      </div>
    )
  }

  return (
    <div className="flex h-[min(640px,calc(100vh-22rem))] min-h-[420px] flex-col gap-2 min-[1280px]:!h-full min-[1280px]:min-h-0">
      <ExperimentalNotice />
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('compilation.fullDescription')}</span>
        <span>{t('compilation.taskCount', { count: tasks.length })}</span>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-lg">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            panOnDrag={true}
            zoomOnScroll={true}
            fitView={true}
            fitViewOptions={{ padding: 0.12 }}
            proOptions={{ hideAttribution: true }}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#cbd5e1"
              className="dark:opacity-30"
            />
            <MiniMap
              position="bottom-right"
              className="right-2! bottom-2! h-[80px]! w-[120px]! rounded border border-border bg-background/80 shadow-sm"
            />
            <Controls
              showInteractive={false}
              position="bottom-left"
              className="bottom-2! left-2!"
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {selectedTaskId && (
        <TaskInlineDetails
          task={taskById.get(selectedTaskId)}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  )
}

function TaskInlineDetails({
  task,
  onClose,
}: {
  task: CompilationDetailTask | undefined
  onClose: () => void
}) {
  const { t } = useTranslation('executions')
  if (!task) return null
  const kind = classifyTask(task.task_id)
  const meta = TASK_KIND_META[kind]
  const Icon = meta.icon
  const humanised = humaniseTaskName(task.task_id)
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon className={`h-4 w-4 ${meta.iconColor}`} />
            <span className="truncate text-sm font-medium">
              {humanised.headline}
            </span>
            <span className="ml-1 text-xs text-muted-foreground">
              · {t(`compilation.taskKind.${meta.labelKey}`)}
            </span>
          </div>
          {humanised.modulePath && (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {humanised.modulePath}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          {t('compilation.close')}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <Field label={t('compilation.fields.taskId')}>
          <code className="block rounded bg-muted px-1.5 py-1 font-mono text-[11px] break-all">
            {task.task_id}
          </code>
        </Field>
        <Field label={t('compilation.fields.parents')}>
          {task.parents.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="space-y-0.5">
              {task.parents.map((parent) => {
                const p = humaniseTaskName(parent)
                return (
                  <li key={parent} className="truncate" title={parent}>
                    {p.headline}
                    {p.hashChip && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        · {p.hashChip}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Field>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
