/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import Dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { FableNodeData } from './fable-to-graph'

export type LayoutDirection = 'LR' | 'TB'

export type NodeAlignment = 'UL' | 'UR' | 'DL' | 'DR' | undefined

export interface LayoutOptions {
  direction?: LayoutDirection
  nodeWidth?: number
  nodeHeight?: number
  nodeSpacingX?: number
  nodeSpacingY?: number
  /** Node alignment within ranks: UL, UR, DL, DR, or undefined for center */
  align?: NodeAlignment
}

/** Map of node IDs to their measured dimensions */
export interface NodeDimensions {
  [nodeId: string]: { width: number; height: number }
}

const DEFAULT_OPTIONS: LayoutOptions & {
  nodeWidth: number
  nodeHeight: number
  nodeSpacingX: number
  nodeSpacingY: number
} = {
  direction: 'TB',
  nodeWidth: 280,
  nodeHeight: 200,
  nodeSpacingX: 80, // Horizontal spacing between sibling nodes
  nodeSpacingY: 100, // Vertical spacing between ranks (more room for edges)
  align: undefined, // Center alignment for symmetrical layout
}

export function layoutNodes(
  nodes: Array<Node<FableNodeData>>,
  edges: Array<Edge>,
  options: LayoutOptions = {},
  nodeDimensions?: NodeDimensions,
): Array<Node<FableNodeData>> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))

  // For TB layout: nodesep = horizontal spacing, ranksep = vertical spacing
  // For LR layout: nodesep = vertical spacing, ranksep = horizontal spacing
  const isVertical = opts.direction === 'TB'
  const nodesep = isVertical ? opts.nodeSpacingX : opts.nodeSpacingY
  const ranksep = isVertical ? opts.nodeSpacingY : opts.nodeSpacingX

  g.setGraph({
    rankdir: opts.direction,
    nodesep, // Spacing between nodes in the same rank
    ranksep, // Spacing between ranks
    marginx: 20,
    marginy: 20,
    align: opts.align, // Center alignment when undefined for symmetrical edges
    ranker: 'network-simplex', // Best algorithm for balanced layouts
  })

  // Use measured dimensions if available, otherwise use defaults
  for (const node of nodes) {
    const measured = nodeDimensions?.[node.id]
    const width = measured?.width ?? opts.nodeWidth
    const height = measured?.height ?? opts.nodeHeight
    g.setNode(node.id, { width, height })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  Dagre.layout(g)

  return nodes.map((node) => {
    const layoutNode = g.node(node.id)
    const measured = nodeDimensions?.[node.id]
    const width = measured?.width ?? opts.nodeWidth
    const height = measured?.height ?? opts.nodeHeight
    return {
      ...node,
      position: {
        x: layoutNode.x - width / 2,
        y: layoutNode.y - height / 2,
      },
    }
  })
}

export function needsLayout(nodes: Array<Node<FableNodeData>>): boolean {
  return nodes.some((node) => node.position.x === 0 && node.position.y === 0)
}
