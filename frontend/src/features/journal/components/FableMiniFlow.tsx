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
 * A small read-only SVG preview of a fable's block pipeline — dagre LR layout,
 * kind-coloured nodes, curved edges. Deliberately tiny to keep journal rows condensed.
 */

import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockKind, FableBuilderV1 } from '@/api/types/fable.types'
import { useBlockCatalogue } from '@/api/hooks/useFable'
import {
  fableToEdges,
  fableToNodes,
} from '@/features/fable-builder/utils/fable-to-graph'
import { layoutNodes } from '@/features/fable-builder/utils/layout-blocks'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

const NODE_W = 100
const NODE_H = 26
const PAD = 5

/** Tailwind fill/stroke classes per block kind. */
const KIND_STYLE: Record<BlockKind, { rect: string; text: string }> = {
  source: {
    rect: 'fill-blue-50 stroke-blue-300 dark:fill-blue-950 dark:stroke-blue-800',
    text: 'fill-blue-700 dark:fill-blue-300',
  },
  transform: {
    rect: 'fill-amber-50 stroke-amber-300 dark:fill-amber-950 dark:stroke-amber-800',
    text: 'fill-amber-700 dark:fill-amber-300',
  },
  product: {
    rect: 'fill-purple-50 stroke-purple-300 dark:fill-purple-950 dark:stroke-purple-800',
    text: 'fill-purple-700 dark:fill-purple-300',
  },
  sink: {
    rect: 'fill-emerald-50 stroke-emerald-300 dark:fill-emerald-950 dark:stroke-emerald-800',
    text: 'fill-emerald-700 dark:fill-emerald-300',
  },
}

/** Neutral node styling for the monochrome toggle. */
const MONO_STYLE = {
  rect: 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
  text: 'fill-slate-600 dark:fill-slate-300',
}

function truncate(label: string): string {
  return label.length > 14 ? `${label.slice(0, 13)}…` : label
}

export function FableMiniFlow({
  builder,
  className,
}: {
  builder: FableBuilderV1
  className?: string
}) {
  const { t } = useTranslation('journal')
  const { data: catalogue } = useBlockCatalogue()
  const arrowId = useId()
  const monochrome = useUiStore((state) => state.journalFlowMonochrome)

  const graph = useMemo(() => {
    if (!catalogue) return null
    const edges = fableToEdges(builder, catalogue)
    const nodes = layoutNodes(fableToNodes(builder, catalogue), edges, {
      direction: 'LR',
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      nodeSpacingX: 32,
      nodeSpacingY: 10,
    })
    if (nodes.length === 0) return null
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return {
      nodes,
      edges,
      byId,
      minX: Math.min(...nodes.map((n) => n.position.x)),
      minY: Math.min(...nodes.map((n) => n.position.y)),
      maxX: Math.max(...nodes.map((n) => n.position.x + NODE_W)),
      maxY: Math.max(...nodes.map((n) => n.position.y + NODE_H)),
    }
  }, [builder, catalogue])

  if (!graph) return null

  const { nodes, edges, byId, minX, minY, maxX, maxY } = graph
  const width = maxX - minX + PAD * 2
  const height = maxY - minY + PAD * 2

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${minX - PAD} ${minY - PAD} ${width} ${height}`}
      preserveAspectRatio="xMidYMin meet"
      className={cn('block h-auto max-h-28 max-w-full', className)}
      role="img"
      aria-label={t('flow.label')}
    >
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path
            d="M0,0 L8,4 L0,8 z"
            className="fill-slate-400 dark:fill-slate-500"
          />
        </marker>
      </defs>

      {edges.map((edge) => {
        const source = byId.get(edge.source)
        const target = byId.get(edge.target)
        if (!source || !target) return null
        const sx = source.position.x + NODE_W
        const sy = source.position.y + NODE_H / 2
        const tx = target.position.x
        const ty = target.position.y + NODE_H / 2
        const mx = (sx + tx) / 2
        return (
          <path
            key={edge.id}
            d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
            className="fill-none stroke-slate-300 dark:stroke-slate-600"
            strokeWidth={1.25}
            markerEnd={`url(#${arrowId})`}
          />
        )
      })}

      {nodes.map((node) => {
        const style = monochrome
          ? MONO_STYLE
          : KIND_STYLE[node.data.factory.kind]
        return (
          <g key={node.id}>
            <rect
              x={node.position.x}
              y={node.position.y}
              width={NODE_W}
              height={NODE_H}
              rx={5}
              strokeWidth={1}
              className={style.rect}
            />
            <text
              x={node.position.x + NODE_W / 2}
              y={node.position.y + NODE_H / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fontWeight={500}
              className={style.text}
            >
              {truncate(node.data.label)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
