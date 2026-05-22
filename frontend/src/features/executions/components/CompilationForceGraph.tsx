/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Force-directed counterpart to the dagre/swimlane Compilation tab.
 * Same task DAG, but laid out live by d3-force with halos
 * behind each block's cluster. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useTranslation } from 'react-i18next'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { CompilationDetailTask, JobStatus } from '@/api/types/job.types'
import { ApiClientError } from '@/api/client'
import { getFactory } from '@/api/types/fable.types'
import { useCompilationDetail } from '@/api/hooks/useJobs'
import { classifyTask } from '@/features/executions/utils/taskClassify'
import {
  buildLineage,
  lineageUnion,
} from '@/features/executions/utils/taskLineage'
import { humaniseTaskName } from '@/features/executions/utils/taskName'
import { useExecutionHoverStore } from '@/features/executions/stores/executionHoverStore'
import { ExperimentalNotice } from '@/features/executions/components/ExperimentalNotice'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { P } from '@/components/base/typography'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type LayoutMode = 'layered' | 'organic'

interface CompilationForceGraphProps {
  jobId: string
  status: JobStatus
  fable: FableBuilderV1 | undefined
  catalogue: BlockFactoryCatalogue | undefined
}

interface GraphNode {
  id: string
  task: CompilationDetailTask
  blockLabel: string
  fill: string
  /** Tasks with no parents — the entry points the user is looking for. */
  isEntry: boolean
  x?: number
  y?: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

/** Task-kind fills mirror the Tailwind 500 hues used by BLOCK_KIND_METADATA
 * (source=blue, transform=amber, product=purple, sink=emerald). Hard-coded
 * because canvas paint doesn't resolve CSS variables, and these are the
 * canonical values the same classes elsewhere in the app render to. */
const TASK_KIND_FILL: Record<string, string> = {
  select: '#f59e0b',
  inference: '#a855f7',
  payload: '#3b82f6',
  plot: '#10b981',
  transform: '#f59e0b',
  unknown: '#64748b',
}

/** Fallback used during SSR / tests where document is unavailable. */
const FALLBACK_BLOCK_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7']

/** Read the app's chart tokens (--chart-1..5 in styles.css) into concrete
 * rgb() strings canvas can paint. A temp element lets the browser do the
 * oklch→rgb resolution and tracks theme changes via inheritance. */
function readChartPalette(): Array<string> {
  if (typeof document === 'undefined') return FALLBACK_BLOCK_PALETTE
  const probe = document.createElement('div')
  document.body.appendChild(probe)
  const colors: Array<string> = []
  for (let i = 1; i <= 5; i++) {
    probe.style.backgroundColor = `var(--chart-${i})`
    const resolved = getComputedStyle(probe).backgroundColor
    if (resolved && resolved !== 'rgba(0, 0, 0, 0)') colors.push(resolved)
  }
  probe.remove()
  return colors.length > 0 ? colors : FALLBACK_BLOCK_PALETTE
}

/** Mix a CSS colour with transparency in oklch space. Used for halo gradient
 * stops; `colour-mix` is supported in all browsers we target. */
function withAlpha(color: string, alpha: number): string {
  const pct = Math.round(alpha * 100)
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

export function CompilationForceGraph({
  jobId,
  status,
  fable,
  catalogue,
}: CompilationForceGraphProps) {
  const { t } = useTranslation('executions')
  const query = useCompilationDetail(jobId, status)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(
    undefined,
  )
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 600,
    height: 480,
  })
  const observerRef = useRef<ResizeObserver | null>(null)

  // Callback ref (not useEffect): the wrapper div is hidden behind early
  // returns for loading/error states, so an empty-deps effect would fire
  // before the div exists and never re-run when it later mounts.
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const measure = () => {
      const w = node.clientWidth
      const h = node.clientHeight
      if (w === 0 || h === 0) return
      setSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    observerRef.current = observer
  }, [])

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
  const lineage = useMemo(() => buildLineage(tasks), [tasks])

  const orderedBlocks = useMemo(() => {
    const seen = new Set<string>()
    const order: Array<string> = []
    for (const task of tasks) {
      if (!seen.has(task.block)) {
        seen.add(task.block)
        order.push(task.block)
      }
    }
    return order
  }, [tasks])

  const blockPalette = useMemo(() => readChartPalette(), [])
  const blockColorById = useMemo(() => {
    const map = new Map<string, string>()
    orderedBlocks.forEach((blockId, index) => {
      map.set(blockId, blockPalette[index % blockPalette.length] ?? '#94a3b8')
    })
    return map
  }, [orderedBlocks, blockPalette])

  const graphData = useMemo(() => {
    const taskIds = new Set(tasks.map((task) => task.task_id))
    // Entry point: every parent reference lies outside the visible slice
    // (or parents is empty). Pinned to the left edge under dagMode='lr'.
    const nodes: Array<GraphNode> = tasks.map((task) => {
      const kind = classifyTask(task.task_id)
      const isEntry = task.parents.every((p) => !taskIds.has(p))
      return {
        id: task.task_id,
        task,
        blockLabel: blockLabelFor(task.block),
        fill: TASK_KIND_FILL[kind] ?? TASK_KIND_FILL.unknown,
        isEntry,
      }
    })
    const links: Array<GraphLink> = []
    for (const task of tasks) {
      for (const parent of task.parents) {
        if (!taskIds.has(parent)) continue
        links.push({ source: parent, target: task.task_id })
      }
    }
    return { nodes, links }
  }, [tasks, blockLabelFor])

  const [hoverId, setHoverId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('organic')
  const anchorId = hoverId ?? selectedId
  const lineageSet = useMemo(() => {
    if (!anchorId) return null
    return lineageUnion(anchorId, lineage)
  }, [anchorId, lineage])

  // One primitive selector per field — an object-returning selector would
  // mint a new reference every render and loop Zustand's Object.is check.
  const selectedBlockId = useExecutionHoverStore(
    (state) => state.selectedBlockId,
  )
  const setSelectedBlockId = useExecutionHoverStore(
    (state) => state.setSelectedBlockId,
  )

  // Data-flow view of a block selection: block's tasks ∪ their ancestor
  // closure. Cascade attributes shared upstream chains to a single owning
  // block — this set lights up everything that feeds the selection
  // regardless of attribution.
  const selectionAncestorSet = useMemo(() => {
    if (!selectedBlockId) return null
    const set = new Set<string>()
    for (const task of tasks) {
      if (task.block !== selectedBlockId) continue
      set.add(task.task_id)
      lineage.ancestors.get(task.task_id)?.forEach((id) => set.add(id))
    }
    return set
  }, [selectedBlockId, tasks, lineage])

  // Per-block companion: any block with at least one task in the data-flow
  // set. Drives halo brightness so contributing blocks lift, not just dim.
  const contributingBlockIds = useMemo(() => {
    if (!selectionAncestorSet) return null
    const set = new Set<string>()
    for (const task of tasks) {
      if (selectionAncestorSet.has(task.task_id)) set.add(task.block)
    }
    return set
  }, [selectionAncestorSet, tasks])

  const focusedTask =
    tasks.find((task) => task.task_id === selectedId) ?? undefined

  useEffect(() => {
    graphRef.current?.d3ReheatSimulation()
  }, [graphData])

  // dagMode change only takes effect after the sim re-runs; the existing
  // onEngineStop handler re-fits once it settles.
  useEffect(() => {
    graphRef.current?.d3ReheatSimulation()
  }, [layoutMode])

  // Re-frame on container resize. The initial settle-fit comes via
  // onEngineStop; this debounce handles later window/sidebar resizes.
  useEffect(() => {
    if (size.width === 0 || size.height === 0) return
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(400, 120)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [size.width, size.height])

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
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('compilation.forceDescription')}</span>
        <div className="flex items-center gap-3">
          <ToggleGroup
            value={[layoutMode]}
            onValueChange={(values) => {
              // Base UI uses `string[]` even for single-select toggles.
              // Empty array = user untoggled — keep the current mode.
              const next = values[0]
              if (next === 'layered' || next === 'organic') {
                setLayoutMode(next)
              }
            }}
            variant="outline"
          >
            <ToggleGroupItem
              value="layered"
              variant="outline"
              aria-label={t('compilation.layoutLayered')}
              className="text-xs"
            >
              {t('compilation.layoutLayered')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="organic"
              variant="outline"
              aria-label={t('compilation.layoutOrganic')}
              className="text-xs"
            >
              {t('compilation.layoutOrganic')}
            </ToggleGroupItem>
          </ToggleGroup>
          <span>
            {layoutMode === 'layered' && `${t('compilation.entryHint')} · `}
            {t('compilation.taskCount', { count: tasks.length })}
          </span>
        </div>
      </div>

      <BlockLegend
        blocks={orderedBlocks}
        colorById={blockColorById}
        labelFor={blockLabelFor}
      />

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden rounded-lg border border-border bg-card"
      >
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          nodeRelSize={4}
          // 'lr' = topological rank constraint; undefined = unbiased d3-force.
          dagMode={layoutMode === 'layered' ? 'lr' : undefined}
          dagLevelDistance={70}
          nodeLabel={(node: GraphNode) => {
            const humanised = humaniseTaskName(node.task.task_id)
            return `${humanised.headline} · ${node.blockLabel}`
          }}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={1}
          linkWidth={1.2}
          linkColor={(link: GraphLink) => {
            const source =
              typeof link.source === 'object' ? link.source : undefined
            const target =
              typeof link.target === 'object' ? link.target : undefined
            const sourceId =
              source?.id ?? (link.source as string | number).toString()
            const targetId =
              target?.id ?? (link.target as string | number).toString()
            const lineageLit =
              !lineageSet ||
              (lineageSet.has(String(sourceId)) &&
                lineageSet.has(String(targetId)))
            // Lit when both endpoints are in the data-flow set — leaf-block
            // selections trace back to the root.
            const blockLit =
              !selectionAncestorSet ||
              (selectionAncestorSet.has(String(sourceId)) &&
                selectionAncestorSet.has(String(targetId)))
            const lit = lineageLit && blockLit
            // Punchier defaults so long cross-cluster edges read against
            // the halo gradient.
            return lit ? 'rgba(71, 85, 105, 0.78)' : 'rgba(100, 116, 139, 0.08)'
          }}
          nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
            if (node.x === undefined || node.y === undefined) return
            const lineageDim = !!lineageSet && !lineageSet.has(node.id)
            const blockDim =
              !!selectionAncestorSet && !selectionAncestorSet.has(node.id)
            ctx.globalAlpha = lineageDim || blockDim ? 0.25 : 1
            const blockColor =
              blockColorById.get(node.task.block) ?? 'rgba(148,163,184,0.6)'
            // Entry points (no in-set parents) get a wider accent ring +
            // bigger fill so "where does this start?" reads at a glance.
            const outerR = node.isEntry ? 11 : 7
            const innerR = node.isEntry ? 7 : 5
            if (node.isEntry) {
              ctx.beginPath()
              ctx.arc(node.x, node.y, 13, 0, 2 * Math.PI)
              ctx.strokeStyle = blockColor
              ctx.lineWidth = 1.5 / globalScale
              ctx.stroke()
            }
            ctx.beginPath()
            ctx.arc(node.x, node.y, outerR, 0, 2 * Math.PI)
            ctx.fillStyle = blockColor
            ctx.fill()
            ctx.beginPath()
            ctx.arc(node.x, node.y, innerR, 0, 2 * Math.PI)
            ctx.fillStyle = node.fill
            ctx.fill()
            if (globalScale > 1.4 || node.isEntry) {
              const humanised = humaniseTaskName(node.task.task_id)
              const label = node.isEntry
                ? `▶ ${humanised.headline}`
                : humanised.headline
              ctx.font = `${(node.isEntry ? 13 : 12) / globalScale}px sans-serif`
              ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'middle'
              ctx.fillText(label, node.x + outerR + 3, node.y)
            }
            ctx.globalAlpha = 1
          }}
          nodePointerAreaPaint={(node: GraphNode, color, ctx) => {
            if (node.x === undefined || node.y === undefined) return
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(node.x, node.y, node.isEntry ? 14 : 10, 0, 2 * Math.PI)
            ctx.fill()
          }}
          onNodeHover={(node) =>
            setHoverId(node ? (node as GraphNode).id : null)
          }
          onNodeClick={(node) => {
            const n = node as GraphNode
            // Picking a task also focuses its block on the left RunCanvas.
            setSelectedId((prev) => (prev === n.id ? null : n.id))
            setSelectedBlockId(
              selectedBlockId === n.task.block ? null : n.task.block,
            )
          }}
          onBackgroundClick={() => {
            setSelectedId(null)
            if (selectedBlockId !== null) setSelectedBlockId(null)
          }}
          onRenderFramePre={(ctx) => {
            // Bloom-style cluster halos: radial gradient per block centred
            // on the cluster centroid. Drawn pre-frame so nodes paint on top.
            const byBlock = new Map<string, Array<[number, number]>>()
            for (const node of graphData.nodes) {
              if (node.x === undefined || node.y === undefined) continue
              const list = byBlock.get(node.task.block) ?? []
              list.push([node.x, node.y])
              byBlock.set(node.task.block, list)
            }
            const HALO_PAD = 40
            const SINGLE_RADIUS = 32
            for (const [blockId, points] of byBlock) {
              if (points.length === 0) continue
              const color = blockColorById.get(blockId) ?? '#94a3b8'
              const cx =
                points.reduce((sum, p) => sum + p[0], 0) / points.length
              const cy =
                points.reduce((sum, p) => sum + p[1], 0) / points.length
              let maxR = 0
              for (const [x, y] of points) {
                const r = Math.hypot(x - cx, y - cy)
                if (r > maxR) maxR = r
              }
              const radius =
                points.length === 1 ? SINGLE_RADIUS : maxR + HALO_PAD
              const gradient = ctx.createRadialGradient(
                cx,
                cy,
                0,
                cx,
                cy,
                radius,
              )
              // Contributing blocks brighten, others fade. Alphas kept
              // soft so the halo never washes out the underlying edges.
              const isFocused =
                !contributingBlockIds || contributingBlockIds.has(blockId)
              const otherSelected =
                !!contributingBlockIds && !contributingBlockIds.has(blockId)
              const inner = otherSelected
                ? 0.09
                : isFocused && selectedBlockId
                  ? 0.32
                  : 0.18
              const mid = otherSelected
                ? 0.04
                : isFocused && selectedBlockId
                  ? 0.13
                  : 0.07
              gradient.addColorStop(0, withAlpha(color, inner))
              gradient.addColorStop(0.55, withAlpha(color, mid))
              gradient.addColorStop(1, withAlpha(color, 0))
              ctx.save()
              ctx.fillStyle = gradient
              ctx.beginPath()
              ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
              ctx.fill()
              ctx.restore()
            }
          }}
          cooldownTicks={120}
          enableNodeDrag={true}
          // d3-force cooldown done — bbox is final, safe to fit cleanly.
          onEngineStop={() => {
            graphRef.current?.zoomToFit(400, 120)
          }}
        />
      </div>

      {focusedTask && (
        <FocusedTaskCard
          task={focusedTask}
          blockLabel={blockLabelFor(focusedTask.block)}
          blockColor={
            blockColorById.get(focusedTask.block) ?? 'rgba(148,163,184,0.6)'
          }
        />
      )}
    </div>
  )
}

function BlockLegend({
  blocks,
  colorById,
  labelFor,
}: {
  blocks: ReadonlyArray<string>
  colorById: ReadonlyMap<string, string>
  labelFor: (blockId: string) => string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {blocks.map((blockId) => (
        <div key={blockId} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colorById.get(blockId) }}
          />
          <span className="truncate" title={blockId}>
            {labelFor(blockId)}
          </span>
        </div>
      ))}
    </div>
  )
}

function FocusedTaskCard({
  task,
  blockLabel,
  blockColor,
}: {
  task: CompilationDetailTask
  blockLabel: string
  blockColor: string
}) {
  const { t } = useTranslation('executions')
  const humanised = humaniseTaskName(task.task_id)
  const kind = classifyTask(task.task_id)
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: TASK_KIND_FILL[kind] }}
        />
        <span className="font-medium">{humanised.headline}</span>
        <span className="text-xs text-muted-foreground">
          · {t(`compilation.taskKind.${kind}`)}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: blockColor }}
          />
          <span className="truncate">{blockLabel}</span>
        </span>
      </div>
      {humanised.modulePath && (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          {humanised.modulePath}
        </p>
      )}
    </div>
  )
}
