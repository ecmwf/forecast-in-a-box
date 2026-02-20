/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
} from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'

import type { EdgeStyle } from '@/features/fable-builder/stores/fableBuilderStore'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

export interface FableEdgeData extends Record<string, unknown> {
  inputName?: string
}

export type FableEdge = Edge<FableEdgeData, 'fableEdge'>

// Fixed offset from source for horizontal segment - ensures all edges from same source align
const TREE_EDGE_OFFSET = 50
// Fallback offset for horizontal layouts (LR/RL)
const STEP_EDGE_OFFSET = 50

/**
 * Creates a tree-style step path where the horizontal segment is at a fixed
 * offset from the source, ensuring all edges from the same source node align
 * at the same Y level for a symmetrical appearance.
 */
function getTreeStepPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  borderRadius = 0,
): [string, number, number] {
  // Use fixed offset from source for consistent alignment across all edges
  const bendY = sourceY + TREE_EDGE_OFFSET

  // Handle case where target is very close to source
  if (targetY <= bendY + borderRadius * 2) {
    // Fall back to direct path if not enough room
    const midY = (sourceY + targetY) / 2
    const path = `M ${sourceX} ${sourceY} L ${sourceX} ${midY} L ${targetX} ${midY} L ${targetX} ${targetY}`
    return [path, (sourceX + targetX) / 2, midY]
  }

  // Create path: down from source -> horizontal to target X -> down to target
  const path =
    borderRadius > 0
      ? // Rounded corners version
        `M ${sourceX} ${sourceY}
       L ${sourceX} ${bendY - borderRadius}
       Q ${sourceX} ${bendY} ${sourceX + Math.sign(targetX - sourceX) * Math.min(borderRadius, Math.abs(targetX - sourceX) / 2)} ${bendY}
       L ${targetX - Math.sign(targetX - sourceX) * Math.min(borderRadius, Math.abs(targetX - sourceX) / 2)} ${bendY}
       Q ${targetX} ${bendY} ${targetX} ${bendY + borderRadius}
       L ${targetX} ${targetY}`
      : // Sharp corners version
        `M ${sourceX} ${sourceY}
       L ${sourceX} ${bendY}
       L ${targetX} ${bendY}
       L ${targetX} ${targetY}`

  // Label position at the horizontal segment center
  const labelX = (sourceX + targetX) / 2
  const labelY = bendY

  return [path, labelX, labelY]
}

function getEdgePath({
  type,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: {
  type: EdgeStyle
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}) {
  switch (type) {
    case 'bezier':
      return getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      })

    case 'smoothstep':
      // Use tree-style path for vertical layouts (TB/BT)
      if (
        (sourcePosition === Position.Bottom &&
          targetPosition === Position.Top) ||
        (sourcePosition === Position.Top && targetPosition === Position.Bottom)
      ) {
        return getTreeStepPath(sourceX, sourceY, targetX, targetY, 8)
      }
      return getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        offset: STEP_EDGE_OFFSET,
      })

    case 'step':
      // Use tree-style path for vertical layouts (TB/BT)
      if (
        (sourcePosition === Position.Bottom &&
          targetPosition === Position.Top) ||
        (sourcePosition === Position.Top && targetPosition === Position.Bottom)
      ) {
        return getTreeStepPath(sourceX, sourceY, targetX, targetY, 0)
      }
      return getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 0,
        offset: STEP_EDGE_OFFSET,
      })
  }
}

export const FableEdgeComponent = memo(function FableEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeStyle = useFableBuilderStore((state) => state.edgeStyle)

  const [edgePath, labelX, labelY] = getEdgePath({
    type: edgeStyle,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const inputName = (data as FableEdgeData | undefined)?.inputName
  const labelTransform = `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={
          selected
            ? 'stroke-primary stroke-[5px]'
            : 'stroke-muted-foreground stroke-[4px]'
        }
      />
      {inputName && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: labelTransform,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span className="rounded border border-border bg-background px-1.5 py-0.5 text-sm text-muted-foreground">
              {inputName}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
