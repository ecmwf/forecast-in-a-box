/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { Edge, Node } from '@xyflow/react'
import type {
  BlockFactory,
  BlockFactoryCatalogue,
  BlockInstance,
  BlockInstanceId,
  FableBuilderV1,
} from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'

export interface FableNodeData extends Record<string, unknown> {
  instanceId: BlockInstanceId
  instance: BlockInstance
  factory: BlockFactory
  label: string
  catalogue: BlockFactoryCatalogue
}

const NODE_TYPE_MAP: Record<string, string> = {
  source: 'sourceBlock',
  product: 'productBlock',
  sink: 'sinkBlock',
  transform: 'transformBlock',
}

function getNodeType(kind: string): string {
  return NODE_TYPE_MAP[kind] ?? 'default'
}

export function fableToNodes(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): Array<Node<FableNodeData>> {
  const nodes: Array<Node<FableNodeData>> = []

  for (const [instanceId, instance] of Object.entries(fable.blocks)) {
    const factory = getFactory(catalogue, instance.factory_id)
    if (!factory) continue

    nodes.push({
      id: instanceId,
      type: getNodeType(factory.kind),
      position: { x: 0, y: 0 },
      data: {
        instanceId,
        instance,
        factory,
        label: factory.title,
        catalogue,
      },
    })
  }

  return nodes
}

export function fableToEdges(
  fable: FableBuilderV1,
  _catalogue: BlockFactoryCatalogue,
): Array<Edge> {
  const edges: Array<Edge> = []

  for (const [targetId, instance] of Object.entries(fable.blocks)) {
    for (const [inputName, sourceId] of Object.entries(instance.input_ids)) {
      if (!sourceId) continue

      edges.push({
        id: `${sourceId}-${targetId}-${inputName}`,
        source: sourceId,
        target: targetId,
        sourceHandle: 'output',
        targetHandle: inputName,
        type: 'fableEdge',
        data: { inputName },
      })
    }
  }

  return edges
}

export function fableToGraph(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): { nodes: Array<Node<FableNodeData>>; edges: Array<Edge> } {
  return {
    nodes: fableToNodes(fable, catalogue),
    edges: fableToEdges(fable, catalogue),
  }
}
