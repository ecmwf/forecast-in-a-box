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
  /** Whether at least one other block consumes this block's output. Precomputed
   *  here so BlockNode never has to subscribe to the whole `fable` state. */
  hasDownstream: boolean
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

/**
 * Per-`instanceId` cache of the last emitted node `data` object. React Flow
 * re-renders a node whenever its `data` reference changes, so reusing the
 * previous object for blocks whose inputs are unchanged keeps memoised nodes
 * from re-rendering when an unrelated block is edited.
 */
const nodeDataCache = new Map<BlockInstanceId, FableNodeData>()

/** Set of instanceIds with a downstream consumer in the current fable. */
function computeDownstreamSources(fable: FableBuilderV1): Set<BlockInstanceId> {
  const sources = new Set<BlockInstanceId>()
  for (const instance of Object.values(fable.blocks)) {
    for (const sourceId of Object.values(instance.input_ids)) {
      if (sourceId) sources.add(sourceId)
    }
  }
  return sources
}

export function fableToNodes(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): Array<Node<FableNodeData>> {
  const nodes: Array<Node<FableNodeData>> = []
  const downstreamSources = computeDownstreamSources(fable)
  const liveIds = new Set<BlockInstanceId>()

  for (const [instanceId, instance] of Object.entries(fable.blocks)) {
    const factory = getFactory(catalogue, instance.factory_id)
    if (!factory) continue
    liveIds.add(instanceId)

    const hasDownstream = downstreamSources.has(instanceId)
    const cached = nodeDataCache.get(instanceId)
    const data: FableNodeData =
      cached &&
      cached.instance === instance &&
      cached.factory === factory &&
      cached.catalogue === catalogue &&
      cached.hasDownstream === hasDownstream
        ? cached
        : {
            instanceId,
            instance,
            factory,
            label: factory.title,
            catalogue,
            hasDownstream,
          }
    nodeDataCache.set(instanceId, data)

    nodes.push({
      id: instanceId,
      type: getNodeType(factory.kind),
      position: { x: 0, y: 0 },
      data,
    })
  }

  // Drop cache entries for removed blocks so the map can't grow unbounded.
  for (const id of nodeDataCache.keys()) {
    if (!liveIds.has(id)) nodeDataCache.delete(id)
  }

  return nodes
}

export function fableToEdges(
  fable: FableBuilderV1,
  // Unused — kept so cross-feature call sites (RunCanvas, FableMiniFlow) and
  // their tests keep type-checking; edges derive purely from `input_ids`.
  _catalogue?: BlockFactoryCatalogue,
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
