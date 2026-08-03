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
 * Same task DAG, laid out live by d3-force; one color per block,
 * lineage lights up in color against a neutral-gray dimmed field. */

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
  /** Tasks with no parents — the entry points the user is looking for. */
  isEntry: boolean
  x?: number
  y?: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

/** Task-kind dot in the focused-task card only — the canvas encodes block,
 * not kind. Hues mirror BLOCK_KIND_METADATA's Tailwind 500 values. */
const TASK_KIND_FILL: Record<string, string> = {
  select: '#f59e0b',
  inference: '#a855f7',
  payload: '#3b82f6',
  plot: '#10b981',
  transform: '#f59e0b',
  unknown: '#64748b',
}

interface GraphTheme {
  palette: Array<string>
  /** Text + lit-edge color (`--foreground`). */
  foreground: string
  /** Flat fill for nodes outside the lineage/selection (`--border`). */
  dim: string
  /** Disc separation stroke — the canvas background (`--card`). */
  surface: string
}

/** Fallback used during SSR / tests where document is unavailable. */
const FALLBACK_THEME: GraphTheme = {
  palette: ['#3b82f6', '#10b981', '#f59e0b', '#a855f7'],
  foreground: '#0f172a',
  dim: '#cbd5e1',
  surface: '#ffffff',
}

/** Resolve the app's CSS tokens into concrete rgb() strings canvas can
 * paint — a temp element lets the browser do the oklch→rgb resolution. */
function readGraphTheme(): GraphTheme {
  if (typeof document === 'undefined') return FALLBACK_THEME
  const probe = document.createElement('div')
  document.body.appendChild(probe)
  const resolve = (variable: string): string | null => {
    probe.style.backgroundColor = `var(${variable})`
    const resolved = getComputedStyle(probe).backgroundColor
    return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : null
  }
  const palette: Array<string> = []
  for (let i = 1; i <= 5; i++) {
    const color = resolve(`--chart-${i}`)
    if (color) palette.push(color)
  }
  const theme: GraphTheme = {
    palette: palette.length > 0 ? palette : FALLBACK_THEME.palette,
    foreground: resolve('--foreground') ?? FALLBACK_THEME.foreground,
    dim: resolve('--border') ?? FALLBACK_THEME.dim,
    surface: resolve('--card') ?? FALLBACK_THEME.surface,
  }
  probe.remove()
  return theme
}

interface ClusterGeometry {
  cx: number
  cy: number
  /** Farthest node distance from the centroid. */
  maxR: number
  count: number
}

/** Per-block centroid + extent, recomputed per frame from live node positions. */
function clusterGeometry(
  nodes: ReadonlyArray<GraphNode>,
): Map<string, ClusterGeometry> {
  const byBlock = new Map<string, Array<[number, number]>>()
  for (const node of nodes) {
    if (node.x === undefined || node.y === undefined) continue
    const list = byBlock.get(node.task.block) ?? []
    list.push([node.x, node.y])
    byBlock.set(node.task.block, list)
  }
  const result = new Map<string, ClusterGeometry>()
  for (const [blockId, points] of byBlock) {
    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length
    let maxR = 0
    for (const [x, y] of points) {
      const r = Math.hypot(x - cx, y - cy)
      if (r > maxR) maxR = r
    }
    result.set(blockId, { cx, cy, maxR, count: points.length })
  }
  return result
}

/** Mix a CSS colour with transparency in oklch space; `color-mix` is
 * supported in all browsers we target, including as a canvas paint. */
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

  const theme = useMemo(() => readGraphTheme(), [])
  const blockColorById = useMemo(() => {
    const map = new Map<string, string>()
    orderedBlocks.forEach((blockId, index) => {
      const base = theme.palette[index % theme.palette.length] ?? '#94a3b8'
      // Soften toward the surface — full-chroma discs read harsh at scale.
      map.set(blockId, `color-mix(in oklch, ${base} 72%, ${theme.surface})`)
    })
    return map
  }, [orderedBlocks, theme])

  const graphData = useMemo(() => {
    const taskIds = new Set(tasks.map((task) => task.task_id))
    // Entry point: every parent reference lies outside the visible slice
    // (or parents is empty). Pinned to the left edge under dagMode='lr'.
    const nodes: Array<GraphNode> = tasks.map((task) => {
      const isEntry = task.parents.every((p) => !taskIds.has(p))
      return {
        id: task.task_id,
        task,
        blockLabel: blockLabelFor(task.block),
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
            // 0.35 keeps dense fan-in bundles from congealing into wedges.
            return lit
              ? withAlpha(theme.foreground, 0.35)
              : withAlpha(theme.foreground, 0.06)
          }}
          nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
            if (node.x === undefined || node.y === undefined) return
            const dimmed =
              (!!lineageSet && !lineageSet.has(node.id)) ||
              (!!selectionAncestorSet && !selectionAncestorSet.has(node.id))
            const blockColor =
              blockColorById.get(node.task.block) ?? 'rgba(148,163,184,0.6)'
            // Dimmed = flat neutral at full opacity — alpha-dimming colored
            // discs blends into mush at cluster density.
            const fill = dimmed ? theme.dim : blockColor
            const r = node.isEntry ? 8.5 : 6.5
            // Entry points (no in-set parents) get a wider accent ring so
            // "where does this start?" reads at a glance.
            if (node.isEntry) {
              ctx.beginPath()
              ctx.arc(node.x, node.y, r + 3.5, 0, 2 * Math.PI)
              ctx.strokeStyle = fill
              ctx.lineWidth = 1.5 / globalScale
              ctx.stroke()
            }
            ctx.beginPath()
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
            ctx.fillStyle = fill
            ctx.fill()
            // Separation stroke in graph units — a screen-constant width
            // fattens when zoomed out and bleaches the fill.
            ctx.strokeStyle = theme.surface
            ctx.lineWidth = 0.75
            ctx.stroke()
            if (node.isEntry || node.id === selectedId) {
              const humanised = humaniseTaskName(node.task.task_id)
              const label = node.isEntry
                ? `▶ ${humanised.headline}`
                : humanised.headline
              ctx.font = `${(node.isEntry ? 13 : 12) / globalScale}px sans-serif`
              ctx.textAlign = 'left'
              ctx.textBaseline = 'middle'
              // Surface outline lifts the label off edge bundles beneath it.
              ctx.lineWidth = 3 / globalScale
              ctx.strokeStyle = withAlpha(theme.surface, 0.9)
              ctx.strokeText(label, node.x + r + 5, node.y)
              ctx.fillStyle = withAlpha(theme.foreground, dimmed ? 0.35 : 0.85)
              ctx.fillText(label, node.x + r + 5, node.y)
            }
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
          onRenderFramePost={(ctx, globalScale) => {
            // One label per cluster while zoomed out — per-node names at
            // this density are pure repetition.
            if (globalScale >= 2) return
            for (const [blockId, cluster] of clusterGeometry(graphData.nodes)) {
              const dimmedBlock =
                !!contributingBlockIds && !contributingBlockIds.has(blockId)
              const label = `${blockLabelFor(blockId)} · ${t(
                'compilation.taskCount',
                { count: cluster.count },
              )}`
              const labelY = cluster.cy + cluster.maxR + 14 / globalScale
              ctx.font = `${12 / globalScale}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              // Surface outline lifts the label off edge bundles beneath it.
              ctx.lineWidth = 3 / globalScale
              ctx.strokeStyle = withAlpha(theme.surface, 0.9)
              ctx.strokeText(label, cluster.cx, labelY)
              ctx.fillStyle = withAlpha(
                theme.foreground,
                dimmedBlock ? 0.25 : 0.7,
              )
              ctx.fillText(label, cluster.cx, labelY)
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
