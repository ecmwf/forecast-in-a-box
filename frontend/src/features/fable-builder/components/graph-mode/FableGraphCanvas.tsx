/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FableEdgeComponent } from './FableEdge'
import { BlockNode } from './nodes/BlockNode'
import { BlockDragPreview } from './BlockDragPreview'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import type { Connection, Edge, EdgeTypes, NodeTypes } from '@xyflow/react'
import type { NodeDimensions } from '@/features/fable-builder/utils/layout-blocks'
import type { FableNode } from './nodes/BlockNode'
import { getFactory } from '@/api/types/fable.types'
import {
  layoutNodes,
  needsLayout,
} from '@/features/fable-builder/utils/layout-blocks'
import { fableToGraph } from '@/features/fable-builder/utils/fable-to-graph'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useSidebarBlockDrop } from '@/features/fable-builder/hooks/useSidebarBlockDrop'
import { useMedia } from '@/hooks/useMedia'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

interface FableGraphCanvasProps {
  catalogue: BlockFactoryCatalogue
}

const nodeTypes: NodeTypes = {
  sourceBlock: BlockNode,
  transformBlock: BlockNode,
  productBlock: BlockNode,
  sinkBlock: BlockNode,
}

const edgeTypes: EdgeTypes = {
  fableEdge: FableEdgeComponent,
}

function FableGraphCanvasInner({ catalogue }: FableGraphCanvasProps) {
  // Must match FableBuilderPage's layout breakpoint (lg).
  const isDesktop = useMedia('(min-width: 1024px)')
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
  const openMobileConfig = useFableBuilderStore(
    (state) => state.openMobileConfig,
  )
  const setHoveredEdge = useFableBuilderStore((state) => state.setHoveredEdge)
  const selectedBlockId = useFableBuilderStore((state) => state.selectedBlockId)

  const { fitView, setViewport, getNodesBounds } = useReactFlow()
  const { onDragOver, onDrop, dropMode } = useSidebarBlockDrop(catalogue)

  const [nodes, setNodes, onNodesChange] = useNodesState<FableNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const containerRef = useRef<HTMLDivElement>(null)
  // Current selection mirrored into a ref so the layout effect can re-apply
  // it on a block-driven rebuild without depending on it (which would force a
  // full re-layout on every selection change).
  const selectedBlockIdRef = useRef(selectedBlockId)
  selectedBlockIdRef.current = selectedBlockId
  const prevBlocksRef = useRef<typeof fable.blocks | null>(null)
  const prevAutoLayoutRef = useRef(autoLayout)
  const prevLayoutDirectionRef = useRef(layoutDirection)
  const hasInitializedViewportRef = useRef<boolean>(false)
  const lastBlockCountRef = useRef<number>(0)
  // New nodes lay out at estimated sizes first — relaid out once measured.
  const [measurePending, setMeasurePending] = useState(false)
  // Full-graph replacement: additionally hidden until the measured layout.
  const [settling, setSettling] = useState(false)

  // Real node sizes, read from the DOM — neither xyflow's dimension events
  // nor its internal store deliver measurements in this controlled setup.
  const measuredDimensions = useCallback((): NodeDimensions => {
    const dims: NodeDimensions = {}
    const els =
      containerRef.current?.querySelectorAll<HTMLElement>('.react-flow__node')
    for (const el of els ?? []) {
      const id = el.getAttribute('data-id')
      if (id && el.offsetHeight > 0) {
        dims[id] = { width: el.offsetWidth, height: el.offsetHeight }
      }
    }
    return dims
  }, [])

  // Relayout with real DOM sizes once all nodes measure (frame-capped poll).
  useEffect(() => {
    if (!measurePending) return
    let cancelled = false
    let attempts = 0
    let frame = 0
    const measure = () => {
      if (cancelled) return
      const dims = measuredDimensions()
      const ready = nodes.length > 0 && nodes.every((node) => node.id in dims)
      if (!ready && attempts < 60) {
        attempts += 1
        frame = requestAnimationFrame(measure)
        return
      }
      if (ready) {
        setNodes((current) =>
          layoutNodes(current, edges, { direction: layoutDirection }, dims),
        )
      }
      setMeasurePending(false)
      setSettling(false)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [
    measurePending,
    nodes,
    edges,
    layoutDirection,
    measuredDimensions,
    setNodes,
  ])

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

    const dimensions = measuredDimensions()
    const shouldLayout = autoLayout || needsLayout(newNodes)
    const layouted = shouldLayout
      ? layoutNodes(
          newNodes,
          newEdges,
          { direction: layoutDirection },
          dimensions,
        )
      : newNodes

    // Detect preset load: going from 0 blocks to multiple blocks
    // In this case, reset the viewport initialization to reposition the graph
    const currentBlockCount = Object.keys(fable.blocks).length
    const previousBlockCount = lastBlockCountRef.current
    if (previousBlockCount === 0 && currentBlockCount > 1) {
      hasInitializedViewportRef.current = false
    }
    lastBlockCountRef.current = currentBlockCount

    // Unmeasured nodes → post-mount relayout; full replacements also hide.
    const unmeasured = layouted.filter((node) => !(node.id in dimensions))
    const anyNew = shouldLayout && unmeasured.length > 0
    setMeasurePending(anyNew)
    setSettling(anyNew && unmeasured.length === layouted.length)

    // Preserve the current selection — `fableToGraph` builds nodes without a
    // `selected` flag, so re-apply it here for the same-commit rebuild.
    setNodes(
      layouted.map((node) =>
        node.id === selectedBlockIdRef.current
          ? { ...node, selected: true }
          : node,
      ),
    )
    setEdges(newEdges)
  }, [
    fable,
    catalogue,
    autoLayout,
    layoutDirection,
    measuredDimensions,
    setNodes,
    setEdges,
  ])

  // Position viewport once on initial load based on layout direction
  // TB: center X on desktop, left-align on mobile, near top Y
  // LR: near left X, center Y on desktop, top-align on mobile
  useEffect(() => {
    if (hasInitializedViewportRef.current) return
    if (nodes.length === 0) return
    // Bounds shift when the measured layout lands — position after it.
    if (settling) return

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

    // Mobile centres the ENTRY node — a fanned bbox parks the first cards off-centre.
    const entry = nodes.reduce((first, node) =>
      (
        layoutDirection === 'LR'
          ? node.position.x < first.position.x
          : node.position.y < first.position.y
      )
        ? node
        : first,
    )

    if (layoutDirection === 'TB') {
      // Position near top
      y = padding - bounds.y

      if (isMobile) {
        x =
          containerWidth / 2 -
          (entry.position.x + (entry.measured?.width ?? 0) / 2)
      } else {
        // On desktop: center horizontally
        const graphCenterX = bounds.x + bounds.width / 2
        x = containerWidth / 2 - graphCenterX
      }
    } else {
      // Position near left
      x = padding - bounds.x

      if (isMobile) {
        y =
          containerHeight / 2 -
          (entry.position.y + (entry.measured?.height ?? 0) / 2)
      } else {
        // On desktop: center vertically
        const graphCenterY = bounds.y + bounds.height / 2
        y = containerHeight / 2 - graphCenterY
      }
    }

    setViewport({ x, y, zoom: 1 })
    hasInitializedViewportRef.current = true
  }, [nodes, layoutDirection, setViewport, settling])

  // Respond to fit view trigger from the header
  useEffect(() => {
    if (fitViewTrigger > 0) {
      fitView({ padding: 0.3, maxZoom: 1 })
    }
  }, [fitViewTrigger, fitView])

  // Refit only on >25% container jumps (rotation/breakpoint) — sidebar drags must not yank the viewport.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let last: { w: number; h: number } | null = null
    let timer = 0
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[entries.length - 1].contentRect
      if (width === 0 || height === 0) return
      if (last === null) {
        last = { w: width, h: height }
        return
      }
      const bigChange =
        Math.abs(width - last.w) / last.w > 0.25 ||
        Math.abs(height - last.h) / last.h > 0.25
      if (!bigChange) return
      last = { w: width, h: height }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        fitView({ padding: 0.2, maxZoom: 1, duration: 200 })
      }, 150)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [fitView])

  // Reflect the store's selected block onto React Flow's `selected` node flag.
  // BlockNode reads only that prop, so a selection change re-renders just the
  // previously- and newly-selected nodes instead of every node on the canvas.
  useEffect(() => {
    setNodes((nds) => {
      const next = nds.map((node) => {
        const shouldSelect = node.id === selectedBlockId
        return node.selected === shouldSelect
          ? node
          : { ...node, selected: shouldSelect }
      })
      return next.some((node, i) => node !== nds[i]) ? next : nds
    })
  }, [selectedBlockId, setNodes])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target && connection.targetHandle) {
        connectBlocks(
          connection.target,
          connection.targetHandle,
          connection.source,
        )

        // Label the optimistic edge only for multi-input targets (cf. fableToEdges).
        const targetFactory = getFactory(
          catalogue,
          fable.blocks[connection.target].factory_id,
        )
        const showLabel = (targetFactory?.inputs.length ?? 0) > 1

        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              type: 'fableEdge',
              data: { inputName: connection.targetHandle, showLabel },
            },
            eds,
          ),
        )
      }
    },
    [connectBlocks, setEdges, fable, catalogue],
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: FableNode) => {
      // Sheet layout: tap = configure (no docked panel to reflect selection).
      if (!isDesktop) {
        openMobileConfig(node.id)
        return
      }
      selectBlock(node.id)
    },
    [selectBlock, isDesktop, openMobileConfig],
  )

  // Hovering a wire reveals its qube-lens handle (ephemeral UI; see FableEdge).
  const onEdgeMouseEnter = useCallback(
    (_: React.MouseEvent, edge: Edge) => setHoveredEdge(edge.id),
    [setHoveredEdge],
  )
  const onEdgeMouseLeave = useCallback(
    () => setHoveredEdge(null),
    [setHoveredEdge],
  )

  // Clicking empty canvas intentionally does NOT deselect the node
  // The sidebar stays with the last-selected node's config. To
  // deselect, use the X button in the ConfigPanel header.

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!nodesLocked}
        className={cn(
          'bg-slate-50 dark:bg-slate-950',
          // Instant hide while settling; fade in once the layout is final.
          settling ? 'opacity-0' : 'transition-opacity duration-150',
        )}
        proOptions={{ hideAttribution: true }}
        // Default 0.5 floor can't fit a wide pipeline into a phone container.
        minZoom={0.1}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="#cbd5e1"
          className="dark:opacity-30"
        />
        <Controls
          showInteractive={false}
          position="bottom-left"
          className="bottom-2! left-2!"
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
      <BlockDragPreview mode={dropMode} />
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
