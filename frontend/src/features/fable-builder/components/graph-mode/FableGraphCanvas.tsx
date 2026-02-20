/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  getNodesBounds,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FableEdgeComponent } from './FableEdge'
import { BlockNode } from './nodes/BlockNode'
import { InlineBlockNode } from './nodes/InlineBlockNode'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import type { Connection, Edge, NodeChange } from '@xyflow/react'
import type { NodeDimensions } from '@/features/fable-builder/utils/layout-blocks'
import type { FableNode } from './nodes/BlockNode'
import {
  layoutNodes,
  needsLayout,
} from '@/features/fable-builder/utils/layout-blocks'
import { fableToGraph } from '@/features/fable-builder/utils/fable-to-graph'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import { useMedia } from '@/hooks/useMedia'
import { useUiStore } from '@/stores/uiStore'

interface FableGraphCanvasProps {
  catalogue: BlockFactoryCatalogue
}

const nodeTypes: Record<string, any> = {
  sourceBlock: BlockNode,
  transformBlock: BlockNode,
  productBlock: BlockNode,
  sinkBlock: BlockNode,
  sourceBlockInline: InlineBlockNode,
  transformBlockInline: InlineBlockNode,
  productBlockInline: InlineBlockNode,
  sinkBlockInline: InlineBlockNode,
}

const edgeTypes: Record<string, any> = {
  fableEdge: FableEdgeComponent,
}

function FableGraphCanvasInner({ catalogue }: FableGraphCanvasProps) {
  const isDesktop = useMedia('(min-width: 768px)')
  const resolvedTheme = useUiStore((state) => state.resolvedTheme)
  const isDark = resolvedTheme === 'dark'

  // Use individual selectors to avoid creating new objects on every render
  const fable = useFableBuilderStore((state) => state.fable)
  const autoLayout = useFableBuilderStore((state) => state.autoLayout)
  const layoutDirection = useFableBuilderStore((state) => state.layoutDirection)
  const nodesLocked = useFableBuilderStore((state) => state.nodesLocked)
  const isMiniMapOpen = useFableBuilderStore((state) => state.isMiniMapOpen)
  const fitViewTrigger = useFableBuilderStore((state) => state.fitViewTrigger)
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const selectBlock = useFableBuilderStore((state) => state.selectBlock)

  const { fitView, setViewport } = useReactFlow()

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<FableNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const prevBlocksRef = useRef<typeof fable.blocks | null>(null)
  const prevAutoLayoutRef = useRef(autoLayout)
  const prevLayoutDirectionRef = useRef(layoutDirection)
  const hasInitializedViewportRef = useRef<boolean>(false)
  const lastBlockCountRef = useRef<number>(0)

  // Debounced re-layout function that uses measured node dimensions
  const debouncedRelayout = useDebouncedCallback(() => {
    if (!autoLayout) return

    const dimensions = nodes.reduce<NodeDimensions>((acc, node) => {
      if (node.measured?.width && node.measured.height) {
        acc[node.id] = {
          width: node.measured.width,
          height: node.measured.height,
        }
      }
      return acc
    }, {})

    const layouted = layoutNodes(
      nodes,
      edges,
      { direction: layoutDirection },
      dimensions,
    )
    setNodes(layouted)
  }, 300)

  // Wrap onNodesChange to detect dimension changes and trigger re-layout
  const onNodesChange = useCallback(
    (changes: Array<NodeChange<FableNode>>) => {
      onNodesChangeInternal(changes)

      // Check for dimension changes
      const hasDimensionChange = changes.some(
        (c) => c.type === 'dimensions' && c.dimensions,
      )

      if (hasDimensionChange && autoLayout) {
        debouncedRelayout()
      }
    },
    [onNodesChangeInternal, autoLayout, debouncedRelayout],
  )

  useEffect(() => {
    // Use reference equality instead of JSON.stringify for change detection.
    // The Zustand store uses immutable updates, so fable.blocks reference
    // changes if and only if the blocks content changes.
    const blocksChanged = fable.blocks !== prevBlocksRef.current
    const layoutChanged =
      autoLayout !== prevAutoLayoutRef.current ||
      layoutDirection !== prevLayoutDirectionRef.current

    if (!blocksChanged && !layoutChanged) return

    prevBlocksRef.current = fable.blocks
    prevAutoLayoutRef.current = autoLayout
    prevLayoutDirectionRef.current = layoutDirection

    const { nodes: newNodes, edges: newEdges } = fableToGraph(fable, catalogue)

    const shouldLayout = autoLayout || needsLayout(newNodes)
    const layouted = shouldLayout
      ? layoutNodes(newNodes, newEdges, { direction: layoutDirection })
      : newNodes

    // Detect preset load: going from 0 blocks to multiple blocks
    // In this case, reset the viewport initialization to reposition the graph
    const currentBlockCount = Object.keys(fable.blocks).length
    const previousBlockCount = lastBlockCountRef.current
    if (previousBlockCount === 0 && currentBlockCount > 1) {
      hasInitializedViewportRef.current = false
    }
    lastBlockCountRef.current = currentBlockCount

    setNodes(layouted)
    setEdges(newEdges)
  }, [fable, catalogue, autoLayout, layoutDirection, setNodes, setEdges])

  // Position viewport once on initial load based on layout direction
  // TB: center X on desktop, left-align on mobile, near top Y
  // LR: near left X, center Y on desktop, top-align on mobile
  useEffect(() => {
    if (hasInitializedViewportRef.current) return
    if (nodes.length === 0) return

    const container = containerRef.current
    if (!container) return

    const bounds = getNodesBounds(nodes)
    if (bounds.width === 0 && bounds.height === 0) return

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    const padding = 20
    const isMobile = containerWidth < 600

    let x: number
    let y: number

    if (layoutDirection === 'TB') {
      // Position near top
      y = padding - bounds.y

      if (isMobile) {
        // On mobile: left-align to ensure visibility
        x = padding - bounds.x
      } else {
        // On desktop: center horizontally
        const graphCenterX = bounds.x + bounds.width / 2
        x = containerWidth / 2 - graphCenterX
      }
    } else {
      // Position near left
      x = padding - bounds.x

      if (isMobile) {
        // On mobile: top-align to ensure visibility
        y = padding - bounds.y
      } else {
        // On desktop: center vertically
        const graphCenterY = bounds.y + bounds.height / 2
        y = containerHeight / 2 - graphCenterY
      }
    }

    setViewport({ x, y, zoom: 1 })
    hasInitializedViewportRef.current = true
  }, [nodes, layoutDirection, setViewport])

  // Respond to fit view trigger from the header
  useEffect(() => {
    if (fitViewTrigger > 0) {
      fitView({ padding: 0.3, maxZoom: 1 })
    }
  }, [fitViewTrigger, fitView])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target && connection.targetHandle) {
        connectBlocks(
          connection.target,
          connection.targetHandle,
          connection.source,
        )

        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              type: 'fableEdge',
              data: { inputName: connection.targetHandle },
            },
            eds,
          ),
        )
      }
    },
    [connectBlocks, setEdges],
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: FableNode) => {
      selectBlock(node.id)
    },
    [selectBlock],
  )

  const onPaneClick = useCallback(() => {
    selectBlock(null)
  }, [selectBlock])

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!nodesLocked}
        className="bg-slate-50 dark:bg-slate-950"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="#cbd5e1"
          className="dark:opacity-30"
        />
        {isMiniMapOpen && isDesktop && (
          <MiniMap
            nodeStrokeWidth={3}
            pannable
            zoomable
            position="bottom-right"
            className="right-4! bottom-4! rounded-lg border border-border shadow-sm"
            style={{ backgroundColor: isDark ? '#0f172a' : undefined }}
            maskColor={isDark ? 'rgba(2, 6, 23, 0.6)' : 'rgba(0, 0, 0, 0.1)'}
          />
        )}
      </ReactFlow>
    </div>
  )
}

export function FableGraphCanvas(props: FableGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <FableGraphCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
