/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Animated beam edge for the execution canvas — used while a job is running.
 * A static dashed track plus a thin "worm" — a single short dash that flows
 * source → target via stroke-dashoffset on a path normalized to pathLength=100.
 */

import { getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'

export function BeamEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  })

  // `objectBoundingBox` filter units collapse on horizontal-only edges (zero
  // height). Pin the filter region in user space, padded around the path's
  // bbox so the glow renders for any orientation.
  const filterId = `beam-glow-${id}`
  const minX = Math.min(sourceX, targetX) - 16
  const minY = Math.min(sourceY, targetY) - 16
  const w = Math.abs(targetX - sourceX) + 32
  const h = Math.abs(targetY - sourceY) + 32

  return (
    <>
      <defs>
        <filter
          id={filterId}
          filterUnits="userSpaceOnUse"
          x={minX}
          y={minY}
          width={w}
          height={h}
        >
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Static dashed track. */}
      <path
        d={path}
        stroke="rgb(245 158 11 / 0.4)"
        strokeWidth={1.5}
        strokeDasharray="3 6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Worm: short dash on a path normalized to length 100, dashoffset
          animated so the dash flows source → target. The glow filter gives
          a subtle bloom; thin stroke keeps it from dominating. */}
      <path
        d={path}
        pathLength={100}
        stroke="rgb(249 115 22)"
        strokeWidth={1.5}
        strokeDasharray="12 88"
        strokeLinecap="round"
        fill="none"
        filter={`url(#${filterId})`}
        style={{ animation: 'beam-flow 1.6s linear infinite' }}
      />
    </>
  )
}
