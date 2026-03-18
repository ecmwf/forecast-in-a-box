/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  BlockKind,
} from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  getFactory,
} from '@/api/types/fable.types'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface PipelineDiagramProps {
  catalogue: BlockFactoryCatalogue
  currentStep: BlockKind
  onBlockClick: (blockId: BlockInstanceId, step: BlockKind) => void
  selectedBlockId: BlockInstanceId | null
}

interface DiagramNode {
  id: BlockInstanceId
  kind: BlockKind
  title: string
  x: number
  y: number
  width: number
  height: number
}

interface DiagramEdge {
  id: string
  sourceId: BlockInstanceId
  targetId: BlockInstanceId
  sourcePt: { x: number; y: number }
  targetPt: { x: number; y: number }
}

// Node dimensions
const NODE_WIDTH = 80
const NODE_HEIGHT = 32
const NODE_SPACING_X = 30
const NODE_SPACING_Y = 16
const LAYER_PADDING = 20

// Color mappings for SVG fills (hex values for better SVG compatibility)
const KIND_COLORS: Record<BlockKind, { fill: string; stroke: string }> = {
  source: { fill: '#dbeafe', stroke: '#3b82f6' }, // blue-100, blue-500
  transform: { fill: '#fef3c7', stroke: '#f59e0b' }, // amber-100, amber-500
  product: { fill: '#f3e8ff', stroke: '#a855f7' }, // purple-100, purple-500
  sink: { fill: '#d1fae5', stroke: '#10b981' }, // emerald-100, emerald-500
}

export function PipelineDiagram({
  catalogue,
  currentStep,
  onBlockClick,
  selectedBlockId,
}: PipelineDiagramProps) {
  const fable = useFableBuilderStore((state) => state.fable)

  // Compute diagram layout
  const { nodes, edges, dimensions } = useMemo(() => {
    // Group blocks by kind (layer)
    const blocksByKind: Record<
      BlockKind,
      Array<{ id: BlockInstanceId; title: string }>
    > = {
      source: [],
      transform: [],
      product: [],
      sink: [],
    }

    for (const [id, instance] of Object.entries(fable.blocks)) {
      const factory = getFactory(catalogue, instance.factory_id)
      if (factory) {
        blocksByKind[factory.kind].push({ id, title: factory.title })
      }
    }

    // Calculate positions
    const computedNodes: Array<DiagramNode> = []
    let currentY = LAYER_PADDING
    let maxWidth = 0

    for (const kind of BLOCK_KIND_ORDER) {
      const blocks = blocksByKind[kind]
      if (blocks.length === 0) continue

      // Calculate total width for this layer
      const layerWidth =
        blocks.length * NODE_WIDTH + (blocks.length - 1) * NODE_SPACING_X

      // Center blocks horizontally
      let currentX = LAYER_PADDING

      for (const block of blocks) {
        computedNodes.push({
          id: block.id,
          kind,
          title: block.title,
          x: currentX,
          y: currentY,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        })
        currentX += NODE_WIDTH + NODE_SPACING_X
      }

      maxWidth = Math.max(maxWidth, layerWidth + 2 * LAYER_PADDING)
      currentY += NODE_HEIGHT + NODE_SPACING_Y
    }

    // Calculate edges from input_ids
    const computedEdges: Array<DiagramEdge> = []
    const nodeMap = new Map(computedNodes.map((n) => [n.id, n]))

    for (const [id, instance] of Object.entries(fable.blocks)) {
      const targetNode = nodeMap.get(id)
      if (!targetNode) continue

      for (const sourceId of Object.values(instance.input_ids)) {
        if (!sourceId) continue
        const sourceNode = nodeMap.get(sourceId)
        if (!sourceNode) continue

        computedEdges.push({
          id: `${sourceId}-${id}`,
          sourceId,
          targetId: id,
          sourcePt: {
            x: sourceNode.x + sourceNode.width / 2,
            y: sourceNode.y + sourceNode.height,
          },
          targetPt: {
            x: targetNode.x + targetNode.width / 2,
            y: targetNode.y,
          },
        })
      }
    }

    return {
      nodes: computedNodes,
      edges: computedEdges,
      dimensions: {
        width: Math.max(maxWidth, 200),
        height: currentY + LAYER_PADDING - NODE_SPACING_Y,
      },
    }
  }, [fable.blocks, catalogue])

  // If no blocks, show placeholder
  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        Add blocks to see the pipeline topology
      </div>
    )
  }

  // Generate bezier curve path for an edge
  const getEdgePath = (edge: DiagramEdge): string => {
    const { sourcePt, targetPt } = edge
    const midY = (sourcePt.y + targetPt.y) / 2
    return `M ${sourcePt.x} ${sourcePt.y} C ${sourcePt.x} ${midY}, ${targetPt.x} ${midY}, ${targetPt.x} ${targetPt.y}`
  }

  // Truncate title to fit in node
  const truncateTitle = (title: string, maxChars: number = 10): string => {
    if (title.length <= maxChars) return title
    return title.slice(0, maxChars - 1) + '…'
  }

  return (
    <svg
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      className="h-auto w-full"
      style={{ minHeight: dimensions.height }}
    >
      {/* Edges */}
      <g className="edges">
        {edges.map((edge) => (
          <path
            key={edge.id}
            d={getEdgePath(edge)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-muted-foreground/50"
            markerEnd="url(#arrowhead)"
          />
        ))}
      </g>

      {/* Arrowhead marker */}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="6"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 8 3, 0 6"
            fill="currentColor"
            className="text-muted-foreground/50"
          />
        </marker>
      </defs>

      {/* Nodes */}
      <g className="nodes">
        {nodes.map((node) => {
          const colors = KIND_COLORS[node.kind]
          const isCurrentStep = node.kind === currentStep
          const isSelected = node.id === selectedBlockId

          return (
            <Tooltip key={node.id}>
              <TooltipTrigger
                render={
                  <g
                    className="cursor-pointer"
                    onClick={() => onBlockClick(node.id, node.kind)}
                  />
                }
              >
                {/* Highlight ring for current step */}
                {isCurrentStep && (
                  <rect
                    x={node.x - 3}
                    y={node.y - 3}
                    width={node.width + 6}
                    height={node.height + 6}
                    rx={8}
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    className="animate-pulse"
                  />
                )}

                {/* Selection ring */}
                {isSelected && (
                  <rect
                    x={node.x - 2}
                    y={node.y - 2}
                    width={node.width + 4}
                    height={node.height + 4}
                    rx={6}
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth={2}
                  />
                )}

                {/* Node background */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={4}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={1}
                  className="transition-all hover:brightness-95"
                />

                {/* Top bar indicator */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={4}
                  rx={4}
                  fill={colors.stroke}
                />
                <rect
                  x={node.x}
                  y={node.y + 2}
                  width={node.width}
                  height={4}
                  fill={colors.stroke}
                />

                {/* Node title */}
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 + 5}
                  textAnchor="middle"
                  className="pointer-events-none fill-foreground text-[10px] font-medium"
                >
                  {truncateTitle(node.title)}
                </text>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-sm">
                <div className="font-medium">{node.title}</div>
                <div className="text-xs text-muted-foreground">
                  {BLOCK_KIND_METADATA[node.kind].label}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </g>
    </svg>
  )
}
