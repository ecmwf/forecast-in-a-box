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
  /** Render the input-name label — only set for edges into multi-input blocks. */
  showLabel?: boolean
}

export type FableEdge = Edge<FableEdgeData, 'fableEdge'>

// Orthogonal edges draw straight (no jog) when their cross-axis gap is within
// this many px; real fan-out/-in bends stay well above it.
const STRAIGHT_THRESHOLD = 24

/** SVG path for the active edge style. Orthogonal styles collapse to a straight
 *  line when the endpoints are nearly aligned (see STRAIGHT_THRESHOLD). */
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
}): [string, number, number] {
  const params = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  }

  if (type === 'bezier') {
    const [path, labelX, labelY] = getBezierPath(params)
    return [path, labelX, labelY]
  }

  // Horizontal flow (Left/Right handles) → cross-axis is Y; vertical flow → X.
  const horizontalFlow =
    sourcePosition === Position.Left || sourcePosition === Position.Right
  const crossGap = horizontalFlow
    ? Math.abs(sourceY - targetY)
    : Math.abs(sourceX - targetX)

  if (crossGap <= STRAIGHT_THRESHOLD) {
    return [
      `M ${sourceX},${sourceY} L ${targetX},${targetY}`,
      (sourceX + targetX) / 2,
      (sourceY + targetY) / 2,
    ]
  }

  const [path, labelX, labelY] =
    type === 'step'
      ? getSmoothStepPath({ ...params, borderRadius: 0 })
      : getSmoothStepPath(params)
  return [path, labelX, labelY]
}

export const FableEdgeComponent = memo(function ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<FableEdge>) {
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

  const inputName = data?.inputName
  const labelTransform = `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={
          selected
            ? 'stroke-primary stroke-[3px]'
            : 'stroke-muted-foreground stroke-2'
        }
      />
      {data?.showLabel && inputName && (
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
