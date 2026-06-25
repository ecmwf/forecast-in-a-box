/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { JobStatus } from '@/api/types/job.types'
import {
  fableToEdges,
  fableToNodes,
} from '@/features/fable-builder/utils/fable-to-graph'
import { layoutNodes } from '@/features/fable-builder/utils/layout-blocks'
import { BeamEdge } from '@/features/executions/components/BeamEdge'
import { RunNode } from '@/features/executions/components/RunNode'
import { useExecutionHoverStore } from '@/features/executions/stores/executionHoverStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ShowConfigContext = createContext(false)

export function useShowConfig() {
  return useContext(ShowConfigContext)
}

export interface BlockProgressInfo {
  completedSet: ReadonlySet<BlockInstanceId>
  plannedSet: ReadonlySet<BlockInstanceId>
  /** Planned − completed; populated only while overall status is `running`. */
  runningSet: ReadonlySet<BlockInstanceId>
}

const EMPTY_PROGRESS: BlockProgressInfo = {
  completedSet: new Set(),
  plannedSet: new Set(),
  runningSet: new Set(),
}

const BlockProgressContext = createContext<BlockProgressInfo>(EMPTY_PROGRESS)

export function useBlockProgress(): BlockProgressInfo {
  return useContext(BlockProgressContext)
}

interface RunCanvasProps {
  fable: FableBuilderV1
  catalogue: BlockFactoryCatalogue
  status?: JobStatus
  /** Optional + nullable: backend emits only on /run/get and clears on terminal status. */
  completedBlockIds?: ReadonlyArray<BlockInstanceId> | null
  plannedBlockIds?: ReadonlyArray<BlockInstanceId> | null
}

const nodeTypes: Record<string, typeof RunNode> = {
  sourceBlock: RunNode,
  transformBlock: RunNode,
  productBlock: RunNode,
  sinkBlock: RunNode,
}

const edgeTypes = {
  beam: BeamEdge,
}

function RunCanvasInner({
  fable,
  catalogue,
  status,
  completedBlockIds,
  plannedBlockIds,
}: RunCanvasProps) {
  // Primitive selectors (per field) — an object-returning selector would
  // mint a new reference each render and loop Zustand's Object.is check.
  const selectedBlockId = useExecutionHoverStore(
    (state) => state.selectedBlockId,
  )
  const setSelectedBlockId = useExecutionHoverStore(
    (state) => state.setSelectedBlockId,
  )
  const { t } = useTranslation('executions')
  const [showConfig, setShowConfig] = useState(true)
  const { fitView } = useReactFlow()
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitialRender = useRef(true)

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false
      return
    }
    // Wait a frame for nodes to re-render at their new size
    requestAnimationFrame(() => {
      fitView({ duration: 300, padding: 0.1 })
    })
  }, [showConfig, fitView])

  // React Flow's mount-time fit locks to the initial container size; refit
  // on resize so wide↔narrow transitions don't strand nodes outside the viewport.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let timer = 0
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[entries.length - 1].contentRect
      if (width === 0 || height === 0) return // skip transient 0×0 during reflow
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        fitView({ padding: 0.15, duration: 200 })
      }, 80)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [fitView])

  const isRunning = status === 'running'

  const blockProgress = useMemo<BlockProgressInfo>(() => {
    const completedSet = new Set<BlockInstanceId>(completedBlockIds ?? [])
    const plannedSet = new Set<BlockInstanceId>(plannedBlockIds ?? [])
    const runningSet = new Set<BlockInstanceId>()
    if (isRunning) {
      for (const id of plannedSet) {
        if (!completedSet.has(id)) runningSet.add(id)
      }
    }
    return { completedSet, plannedSet, runningSet }
  }, [completedBlockIds, plannedBlockIds, isRunning])

  const { layoutedNodes, edges, canvasHeight } = useMemo(() => {
    const nodes = fableToNodes(fable, catalogue)
    const edgeList = fableToEdges(fable, catalogue)
    // 130/48 reserves enough vertical room that stacked sinks don't touch,
    // without leaving the canvas feeling sparse.
    const laid = layoutNodes(nodes, edgeList, {
      direction: 'LR',
      nodeHeight: 130,
      nodeSpacingY: 48,
    })
    const hasPlanInfo = blockProgress.plannedSet.size > 0
    const remapped = edgeList.map((e) => {
      // Not running → always smoothstep.
      // Running with detailed plan → beam only edges into currently-running
      // blocks; finished and not-yet-started edges stay static.
      // Running without detailed plan (older backend, or pre-plan tick) →
      // fall back to beaming everything as before.
      const shouldBeam =
        isRunning && (!hasPlanInfo || blockProgress.runningSet.has(e.target))
      return {
        ...e,
        type: shouldBeam ? ('beam' as const) : ('smoothstep' as const),
        animated: false,
        style: undefined,
      }
    })
    return {
      layoutedNodes: laid,
      edges: remapped,
      canvasHeight: computeCanvasHeight(laid),
    }
  }, [fable, catalogue, isRunning, blockProgress])

  return (
    <ShowConfigContext value={showConfig}>
      <BlockProgressContext value={blockProgress}>
        <div
          ref={containerRef}
          style={{ height: `${canvasHeight}px` }}
          className={cn(
            'relative overflow-hidden rounded-lg',
            // Narrow: inline `height` is the authority (React Flow needs a
            // definite height, not just `min-height`). Wide: `!h-full`
            // overrides it so the canvas fills the bounded column.
            'min-[1280px]:!h-full min-[1280px]:min-h-0 min-[1280px]:flex-1',
            // No border — the dotted background already provides framing.
            // Status feedback comes from a soft glow halo only.
            status === 'running' && 'shadow-[0_0_12px_rgba(251,191,36,0.3)]',
            status === 'failed' && 'shadow-[0_0_12px_rgba(239,68,68,0.3)]',
            status === 'completed' && 'shadow-[0_0_12px_rgba(34,197,94,0.25)]',
          )}
        >
          {status === 'running' && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-700">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('detail.running')}
            </div>
          )}
          <ReactFlow
            nodes={layoutedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={true}
            zoomOnScroll={true}
            fitView={true}
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_event, node) => {
              // Toggle: click the already-selected block to clear.
              setSelectedBlockId(selectedBlockId === node.id ? null : node.id)
            }}
            onPaneClick={() => {
              if (selectedBlockId !== null) setSelectedBlockId(null)
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.5}
              color="#cbd5e1"
              className="dark:opacity-30"
            />
            <MiniMap
              nodeStrokeWidth={3}
              position="bottom-right"
              maskColor="transparent"
              className="right-2! bottom-2! h-[60px]! w-[90px]! rounded border border-border bg-background/80 shadow-sm"
            />
            <Controls
              showInteractive={false}
              position="bottom-left"
              className="bottom-2! left-2!"
            />
            <Panel position="top-left" className="top-2! left-2!">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 bg-background/80 text-sm backdrop-blur-sm"
                onClick={() => setShowConfig((prev) => !prev)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {showConfig
                  ? t('detail.hideParameters')
                  : t('detail.showParameters')}
              </Button>
            </Panel>
          </ReactFlow>
        </div>
      </BlockProgressContext>
    </ShowConfigContext>
  )
}

export function RunCanvas(props: RunCanvasProps) {
  return (
    <ReactFlowProvider>
      <RunCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

const MIN_CANVAS_HEIGHT = 280
const MAX_CANVAS_HEIGHT = 520
/** Padding above + below the laid-out nodes so the Show-config / minimap /
 * controls overlays don't clip the top/bottom rows. */
const VERTICAL_CHROME_PADDING = 96

interface PositionedNode {
  position: { x: number; y: number }
  measured?: { width?: number; height?: number }
  width?: number
  height?: number
}

/**
 * Compute a viewport height that fits the laid-out node bbox. Falls back
 * to MIN_CANVAS_HEIGHT for empty / tiny graphs and clamps at
 * MAX_CANVAS_HEIGHT so a runaway graph doesn't take over the page.
 */
function computeCanvasHeight(nodes: ReadonlyArray<PositionedNode>): number {
  if (nodes.length === 0) return MIN_CANVAS_HEIGHT
  let maxBottom = 0
  for (const node of nodes) {
    // dagre sets `width`/`height` on the node; fall back to a sensible
    // default if the layout step skipped a node for any reason.
    const h = node.measured?.height ?? node.height ?? 130
    const bottom = node.position.y + h
    if (bottom > maxBottom) maxBottom = bottom
  }
  const total = maxBottom + VERTICAL_CHROME_PADDING
  return Math.max(MIN_CANVAS_HEIGHT, Math.min(MAX_CANVAS_HEIGHT, total))
}
