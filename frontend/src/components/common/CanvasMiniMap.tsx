/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { MiniMap } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { BlockKind } from '@/api/types/fable.types'
import { useUiStore } from '@/stores/uiStore'

/** Block-kind fills: the cards' top-bar hues (blue/amber/purple/emerald 500) at half strength. */
export const BLOCK_KIND_MINIMAP_COLOR: Record<BlockKind, string> = {
  source: 'rgba(59, 130, 246, 0.5)',
  transform: 'rgba(245, 158, 11, 0.5)',
  product: 'rgba(168, 85, 247, 0.5)',
  sink: 'rgba(16, 185, 129, 0.5)',
}

/** Kind-agnostic fill for grouping frames and unknown node types. */
export const NEUTRAL_MINIMAP_COLOR = 'rgba(148, 163, 184, 0.35)'

const NODE_TYPE_TO_KIND: Record<string, BlockKind> = {
  sourceBlock: 'source',
  transformBlock: 'transform',
  productBlock: 'product',
  sinkBlock: 'sink',
}

/** Fill for the canvas block node types used by Configure and the run canvas. */
export function blockNodeMinimapColor(node: Pick<Node, 'type'>): string {
  const kind = node.type ? NODE_TYPE_TO_KIND[node.type] : undefined
  return kind ? BLOCK_KIND_MINIMAP_COLOR[kind] : NEUTRAL_MINIMAP_COLOR
}

interface CanvasMiniMapProps {
  /** Per-node fill; defaults to the block-kind palette by node type. */
  nodeColor?: (node: Node) => string
}

/** One minimap for every React Flow canvas: same size, corner and theming. */
export function CanvasMiniMap({
  nodeColor = blockNodeMinimapColor,
}: CanvasMiniMapProps) {
  const isDark = useUiStore((state) => state.resolvedTheme === 'dark')
  return (
    <MiniMap
      nodeColor={nodeColor}
      nodeStrokeWidth={3}
      pannable
      zoomable
      position="bottom-right"
      className="right-2! bottom-2! rounded-lg border border-border shadow-sm"
      // The SVG takes its size from `style`, not the class box.
      style={{
        width: 160,
        height: 120,
        backgroundColor: isDark ? '#0f172a' : undefined,
      }}
      maskColor={isDark ? 'rgba(2, 6, 23, 0.6)' : 'rgba(0, 0, 0, 0.1)'}
    />
  )
}
