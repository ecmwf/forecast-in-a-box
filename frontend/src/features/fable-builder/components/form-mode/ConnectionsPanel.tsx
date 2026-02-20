/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { AddBlockNode, MiniPipelineNode } from './mini-graph'
import type { ControlDirection } from './mini-graph'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { BLOCK_KIND_ORDER, getFactory } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { cn } from '@/lib/utils'

interface ConnectionsPanelProps {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
  onBlockClick?: (blockId: BlockInstanceId) => void
  onAddConnectedBlock?: (
    factoryId: PluginBlockFactoryId,
    sourceBlockId: BlockInstanceId,
  ) => void
}

interface ConnectedBlock {
  id: BlockInstanceId
  title: string
  kind: BlockKind
  hasErrors: boolean
}

const nodeTypes: NodeTypes = {
  miniPipeline: MiniPipelineNode,
  addBlock: AddBlockNode,
}

// Layout constants - simple column-based positioning
const COLUMN_X: Record<BlockKind, number> = {
  source: 20,
  transform: 160,
  product: 300,
  sink: 440,
}
const ROW_SPACING = 60
const PADDING_Y = 20

function ConnectionsPanelContent({
  instanceId,
  catalogue,
  onBlockClick,
  onAddConnectedBlock,
}: ConnectionsPanelProps) {
  // Default to expanded
  const [isExpanded, setIsExpanded] = useState(true)

  const fable = useFableBuilderStore((state) => state.fable)
  const validationState = useFableBuilderStore((state) => state.validationState)

  const instance = fable.blocks[instanceId]
  const factory = getFactory(catalogue, instance.factory_id)
  const thisBlockKind = factory?.kind

  // Compute the full pipeline graph - show ALL blocks in the fable
  const { allBlocks, stageData } = useMemo(() => {
    const blocks: Array<ConnectedBlock> = []
    const stages: Record<
      BlockKind,
      {
        blocks: Array<ConnectedBlock>
        addOptions: Array<{ factoryId: PluginBlockFactoryId; title: string }>
      }
    > = {
      source: { blocks: [], addOptions: [] },
      transform: { blocks: [], addOptions: [] },
      product: { blocks: [], addOptions: [] },
      sink: { blocks: [], addOptions: [] },
    }

    if (!factory || !thisBlockKind)
      return { allBlocks: blocks, stageData: stages }

    // Add ALL blocks from the fable (not just connected ones)
    for (const [blockId, blockInstance] of Object.entries(fable.blocks)) {
      const blockFactory = getFactory(catalogue, blockInstance.factory_id)
      if (!blockFactory) continue

      const blockValidationState = validationState?.blockStates[blockId]
      const connBlock: ConnectedBlock = {
        id: blockId,
        title: blockFactory.title,
        kind: blockFactory.kind,
        hasErrors: blockValidationState?.hasErrors ?? false,
      }
      blocks.push(connBlock)
      stages[blockFactory.kind].blocks.push(connBlock)
    }

    // Populate addOptions from the full catalogue for each kind
    // This allows users to add any block type from the mini-graph controls
    for (const [pluginKey, plugin] of Object.entries(catalogue)) {
      const [store, local] = pluginKey.split('/')
      for (const [factoryKey, factoryDef] of Object.entries(plugin.factories)) {
        stages[factoryDef.kind].addOptions.push({
          factoryId: {
            plugin: { store, local },
            factory: factoryKey,
          },
          title: factoryDef.title,
        })
      }
    }

    return { allBlocks: blocks, stageData: stages }
  }, [
    instance,
    factory,
    thisBlockKind,
    instanceId,
    fable.blocks,
    catalogue,
    validationState,
  ])

  // Compute all siblings (blocks of same kind not in the pipeline)
  const allBlocksByKind = useMemo(() => {
    const result: Record<
      BlockKind,
      Array<{ id: BlockInstanceId; title: string }>
    > = {
      source: [],
      transform: [],
      product: [],
      sink: [],
    }

    for (const [blockId, block] of Object.entries(fable.blocks)) {
      const blockFactory = getFactory(catalogue, block.factory_id)
      if (blockFactory) {
        result[blockFactory.kind].push({
          id: blockId,
          title: blockFactory.title,
        })
      }
    }

    return result
  }, [fable.blocks, catalogue])

  // Create callbacks for node controls
  const handleNodeClick = useCallback(
    (blockId: BlockInstanceId) => {
      onBlockClick?.(blockId)
    },
    [onBlockClick],
  )

  const handleAddBlock = useCallback(
    (factoryId: PluginBlockFactoryId, _direction: ControlDirection) => {
      onAddConnectedBlock?.(factoryId, instanceId)
    },
    [onAddConnectedBlock, instanceId],
  )

  const handleNavigate = useCallback(
    (blockId: BlockInstanceId) => {
      onBlockClick?.(blockId)
    },
    [onBlockClick],
  )

  // Build nodes and edges
  const { nodes, edges, graphHeight } = useMemo(() => {
    const nodeList: Array<Node> = []
    const edgeList: Array<Edge> = []
    const seenIds = new Set<string>()

    // Track row counts per column for positioning
    const rowCounts: Record<BlockKind, number> = {
      source: 0,
      transform: 0,
      product: 0,
      sink: 0,
    }

    // Calculate parent/child/sibling options for each node
    const getNodeControls = (block: ConnectedBlock) => {
      const thisKindIndex = BLOCK_KIND_ORDER.indexOf(block.kind)

      // Parent options: kinds before this one that have addOptions
      const parentKinds = BLOCK_KIND_ORDER.slice(0, thisKindIndex)
      const parentOptions = parentKinds.flatMap(
        (kind) => stageData[kind].addOptions,
      )

      // Child options: kinds after this one that have addOptions
      const childKinds = BLOCK_KIND_ORDER.slice(thisKindIndex + 1)
      const childOptions = childKinds.flatMap(
        (kind) => stageData[kind].addOptions,
      )

      // Sibling options: same kind addOptions
      const siblingOptions = stageData[block.kind].addOptions

      // Existing blocks for navigation
      const connectedIds = new Set(allBlocks.map((b) => b.id))

      const existingParents = parentKinds.flatMap((kind) =>
        allBlocksByKind[kind].filter(
          (b) => !connectedIds.has(b.id) || b.id !== block.id,
        ),
      )

      const existingChildren = childKinds.flatMap((kind) =>
        allBlocksByKind[kind].filter(
          (b) => !connectedIds.has(b.id) || b.id !== block.id,
        ),
      )

      const existingSiblings = allBlocksByKind[block.kind].filter(
        (b) => b.id !== block.id,
      )

      return {
        parentOptions,
        childOptions,
        siblingOptions,
        existingParents,
        existingChildren,
        existingSiblings,
      }
    }

    // Add nodes for each connected block
    for (const block of allBlocks) {
      if (seenIds.has(block.id)) continue
      seenIds.add(block.id)

      const controls = getNodeControls(block)
      const row = rowCounts[block.kind]
      rowCounts[block.kind]++

      nodeList.push({
        id: block.id,
        type: 'miniPipeline',
        position: {
          x: COLUMN_X[block.kind],
          y: PADDING_Y + row * ROW_SPACING,
        },
        data: {
          instanceId: block.id,
          title: block.title,
          kind: block.kind,
          hasErrors: block.hasErrors,
          isCurrentBlock: block.id === instanceId,
          ...controls,
          onNodeClick: handleNodeClick,
          onAddBlock: handleAddBlock,
          onNavigate: handleNavigate,
        },
      })
    }

    // Add "AddBlockNode" for stages that have addOptions but no connected blocks
    for (const kind of BLOCK_KIND_ORDER) {
      const hasBlocksInStage = allBlocks.some((b) => b.kind === kind)
      const hasAddOptions = stageData[kind].addOptions.length > 0

      if (!hasBlocksInStage && hasAddOptions && kind !== thisBlockKind) {
        nodeList.push({
          id: `add-${kind}`,
          type: 'addBlock',
          position: {
            x: COLUMN_X[kind],
            y: PADDING_Y,
          },
          data: {
            kind,
            addOptions: stageData[kind].addOptions,
            onAddBlock: (factoryId: PluginBlockFactoryId) => {
              onAddConnectedBlock?.(factoryId, instanceId)
            },
          },
        })
      }
    }

    // Create edges from input_ids relationships
    for (const block of allBlocks) {
      const blockInstance = fable.blocks[block.id]

      for (const sourceId of Object.values(blockInstance.input_ids)) {
        if (!sourceId || !seenIds.has(sourceId)) continue

        edgeList.push({
          id: `${sourceId}-${block.id}`,
          source: sourceId,
          target: block.id,
          type: 'default',
          style: { stroke: '#64748b', strokeWidth: 2 },
          animated: false,
        })
      }
    }

    // Calculate graph height
    const maxRows = Math.max(...Object.values(rowCounts), 1)
    const height = PADDING_Y * 2 + maxRows * ROW_SPACING

    return {
      nodes: nodeList,
      edges: edgeList,
      graphHeight: Math.max(height, 80),
    }
  }, [
    allBlocks,
    stageData,
    thisBlockKind,
    instanceId,
    fable.blocks,
    allBlocksByKind,
    handleNodeClick,
    handleAddBlock,
    handleNavigate,
    onAddConnectedBlock,
  ])

  // Summary counts for collapsed view
  const { inputCount, outputCount } = useMemo(() => {
    if (!thisBlockKind) return { inputCount: 0, outputCount: 0 }
    const thisStageIndex = BLOCK_KIND_ORDER.indexOf(thisBlockKind)

    const inputs = BLOCK_KIND_ORDER.slice(0, thisStageIndex).reduce(
      (count, kind) =>
        count +
        stageData[kind].blocks.filter((b) => b.id !== instanceId).length,
      0,
    )

    const outputs = BLOCK_KIND_ORDER.slice(thisStageIndex + 1).reduce(
      (count, kind) => count + stageData[kind].blocks.length,
      0,
    )

    return { inputCount: inputs, outputCount: outputs }
  }, [stageData, thisBlockKind, instanceId])

  // Check if this block has no downstream connections
  const hasNoDownstream = outputCount === 0 && thisBlockKind !== 'sink'

  if (!factory || !thisBlockKind) return null

  return (
    <div className="border-t">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            isExpanded && 'rotate-90',
          )}
        />
        <span className="text-sm font-medium">Pipeline Flow</span>
        {/* Summary badges when collapsed */}
        {!isExpanded && (
          <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
            {inputCount > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                {inputCount} input{inputCount !== 1 && 's'}
              </span>
            )}
            {inputCount > 0 && outputCount > 0 && <span>→</span>}
            {outputCount > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                {outputCount} output{outputCount !== 1 && 's'}
              </span>
            )}
            {inputCount === 0 && outputCount === 0 && (
              <span className="italic">No connections</span>
            )}
          </span>
        )}
      </button>

      {/* Expanded: React Flow mini-graph */}
      {isExpanded && (
        <div className="px-4 pb-4">
          {hasNoDownstream && (
            <div className="mb-3 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm">
                Not connected to any downstream block
              </span>
            </div>
          )}

          <div
            className="overflow-hidden rounded-md border bg-muted/20"
            style={{ height: graphHeight }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              zoomOnPinch={false}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            </ReactFlow>
          </div>
        </div>
      )}
    </div>
  )
}

export function ConnectionsPanel(props: ConnectionsPanelProps) {
  return (
    <ReactFlowProvider>
      <ConnectionsPanelContent {...props} />
    </ReactFlowProvider>
  )
}
