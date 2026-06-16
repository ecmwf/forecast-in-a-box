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
  useStore,
} from '@xyflow/react'
import { EdgeQubeLens } from './EdgeQubeLens'
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

// Below this zoom the faint qube-lens handle is hidden to avoid clutter; it
// still appears on hover (hovering the wire forces it visible).
const LENS_ZOOM_THRESHOLD = 0.5

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
  source,
  target,
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
  // Per-edge boolean selectors keep re-renders scoped to the edge whose state
  // actually flips (a raw hoveredEdgeId/zoom subscription would re-render all).
  const isHovered = useFableBuilderStore((state) => state.hoveredEdgeId === id)
  const lensHiddenByZoom = useStore(
    (state) => state.transform[2] < LENS_ZOOM_THRESHOLD,
  )

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

  // Offset the qube-lens handle off the input-name badge when both share the
  // midpoint (multi-input edges). Cross-axis = Y for horizontal flow, else X.
  const horizontalFlow =
    sourcePosition === Position.Left || sourcePosition === Position.Right
  const lensDx = data?.showLabel && !horizontalFlow ? -30 : 0
  const lensDy = data?.showLabel && horizontalFlow ? -18 : 0
  const lensTransform = `translate(-50%, -50%) translate(${labelX + lensDx}px, ${labelY + lensDy}px)`

  // Faint by default; the hovered (or selected) wire reveals it. Hidden at far
  // zoom unless hovered, so a dense graph stays uncluttered.
  const lensActive = isHovered || Boolean(selected)
  const showLens = !lensHiddenByZoom || isHovered

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
      {showLens && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: lensTransform,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <EdgeQubeLens
              sourceId={source}
              targetId={target}
              inputName={inputName ?? 'dataset'}
              hovered={lensActive}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
