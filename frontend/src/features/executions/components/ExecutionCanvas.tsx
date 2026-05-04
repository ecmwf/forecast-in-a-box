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
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { JobStatus } from '@/api/types/job.types'
import {
  fableToEdges,
  fableToNodes,
} from '@/features/fable-builder/utils/fable-to-graph'
import { layoutNodes } from '@/features/fable-builder/utils/layout-blocks'
import { BeamEdge } from '@/features/executions/components/BeamEdge'
import { ExecutionNode } from '@/features/executions/components/ExecutionNode'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ShowConfigContext = createContext(false)

export function useShowConfig() {
  return useContext(ShowConfigContext)
}

interface ExecutionCanvasProps {
  fable: FableBuilderV1
  catalogue: BlockFactoryCatalogue
  status?: JobStatus
}

const nodeTypes: Record<string, typeof ExecutionNode> = {
  sourceBlock: ExecutionNode,
  transformBlock: ExecutionNode,
  productBlock: ExecutionNode,
  sinkBlock: ExecutionNode,
}

const edgeTypes = {
  beam: BeamEdge,
}

function ExecutionCanvasInner({
  fable,
  catalogue,
  status,
}: ExecutionCanvasProps) {
  const { t } = useTranslation('executions')
  const [showConfig, setShowConfig] = useState(false)
  const { fitView } = useReactFlow()
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

  const isRunning = status === 'running'

  const { layoutedNodes, edges, canvasHeight } = useMemo(() => {
    const nodes = fableToNodes(fable, catalogue)
    const edgeList = fableToEdges(fable, catalogue)
    // The execution node renders compact (~110px tall when collapsed); dagre's
    // default nodeHeight=200 + nodeSpacingY=100 over-reserves vertical room.
    const laid = layoutNodes(nodes, edgeList, {
      direction: 'LR',
      nodeHeight: 110,
      nodeSpacingY: 40,
    })
    const remapped = edgeList.map((e) => ({
      ...e,
      // While running: custom beam edge with a flowing dash over a static
      // track. Otherwise: the default smoothstep edge.
      type: isRunning ? ('beam' as const) : ('smoothstep' as const),
      animated: false,
      style: undefined,
    }))
    return {
      layoutedNodes: laid,
      edges: remapped,
      canvasHeight: computeCanvasHeight(laid),
    }
  }, [fable, catalogue, isRunning])

  return (
    <ShowConfigContext value={showConfig}>
      <div
        style={{ minHeight: `${canvasHeight}px` }}
        className={cn(
          'relative h-full min-h-0 flex-1 overflow-hidden rounded-lg',
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
            Running...
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
              {showConfig ? t('detail.hideConfig') : t('detail.showConfig')}
            </Button>
          </Panel>
        </ReactFlow>
      </div>
    </ShowConfigContext>
  )
}

export function ExecutionCanvas(props: ExecutionCanvasProps) {
  return (
    <ReactFlowProvider>
      <ExecutionCanvasInner {...props} />
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
