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
 * A dashed track with slow drifting dots on every edge; edges into
 * currently-running blocks (`data.worm`) add a glowing "worm" — a short dash
 * flowing source → target via stroke-dashoffset on a pathLength=100 path.
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
  data,
}: EdgeProps) {
  const worm = data?.worm !== false
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
      {worm && (
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
      )}

      {/* Static dashed track. */}
      <path
        d={path}
        stroke="var(--muted-foreground)"
        strokeOpacity={0.3}
        strokeWidth={1.5}
        strokeDasharray="3 6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Drifting dots: round-cap micro-dashes on a slower loop than the
          worm, so it periodically overtakes them. */}
      <path
        d={path}
        pathLength={100}
        stroke="var(--primary)"
        strokeOpacity={0.75}
        strokeWidth={3}
        strokeDasharray="0.1 49.9"
        strokeLinecap="round"
        fill="none"
        style={{
          animation: 'beam-flow 5.2s linear infinite',
          animationDelay: '-2s',
        }}
      />

      {/* Worm: short dash on a path normalized to length 100, dashoffset
          animated so the dash flows source → target. The glow filter gives
          a subtle bloom; thin stroke keeps it from dominating. */}
      {worm && (
        <path
          d={path}
          pathLength={100}
          stroke="var(--primary)"
          strokeWidth={1.5}
          strokeDasharray="12 88"
          strokeLinecap="round"
          fill="none"
          filter={`url(#${filterId})`}
          style={{ animation: 'beam-flow 1.6s linear infinite' }}
        />
      )}
    </>
  )
}
