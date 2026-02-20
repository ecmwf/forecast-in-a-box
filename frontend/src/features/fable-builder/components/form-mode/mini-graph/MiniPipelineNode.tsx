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
import { Handle, Position } from '@xyflow/react'
import { AlertCircle, Check } from 'lucide-react'
import { NodeControls } from './NodeControls'
import type { Node, NodeProps } from '@xyflow/react'
import type { ControlDirection } from './NodeControls'
import type {
  BlockInstanceId,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import { BLOCK_KIND_METADATA } from '@/api/types/fable.types'
import { cn } from '@/lib/utils'

interface ControlOption {
  factoryId: PluginBlockFactoryId
  title: string
}

interface ExistingBlock {
  id: BlockInstanceId
  title: string
}

export interface MiniPipelineNodeData extends Record<string, unknown> {
  instanceId: BlockInstanceId
  title: string
  kind: BlockKind
  hasErrors: boolean
  isCurrentBlock: boolean
  // Control options
  parentOptions: Array<ControlOption>
  childOptions: Array<ControlOption>
  siblingOptions: Array<ControlOption>
  existingParents: Array<ExistingBlock>
  existingChildren: Array<ExistingBlock>
  existingSiblings: Array<ExistingBlock>
  // Callbacks
  onNodeClick: (blockId: BlockInstanceId) => void
  onAddBlock: (
    factoryId: PluginBlockFactoryId,
    direction: ControlDirection,
  ) => void
  onNavigate: (blockId: BlockInstanceId) => void
}

export type MiniPipelineNodeType = Node<MiniPipelineNodeData>

/**
 * Compact node component for the mini pipeline visualization.
 * ~100px wide x 36px tall with:
 * - 3px colored top bar (kind color)
 * - Truncated title (max ~12 chars)
 * - Small validation icon (12x12) top-right corner
 * - Highlight ring when isCurrentBlock
 * - onClick main area → navigate to block
 */
export const MiniPipelineNode = memo(function MiniPipelineNode({
  data,
}: NodeProps<MiniPipelineNodeType>) {
  const {
    instanceId,
    title,
    kind,
    hasErrors,
    isCurrentBlock,
    parentOptions,
    childOptions,
    siblingOptions,
    existingParents,
    existingChildren,
    existingSiblings,
    onNodeClick,
    onAddBlock,
    onNavigate,
  } = data

  const metadata = BLOCK_KIND_METADATA[kind]
  const truncatedTitle = title.length > 12 ? title.slice(0, 11) + '…' : title

  return (
    <div className="group/node relative -m-2 p-2">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="h-2! w-2! border! border-border! bg-background!"
        style={{ left: 8 }}
      />

      {/* Main node body */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onNodeClick(instanceId)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'relative flex h-9 w-25 flex-col overflow-hidden rounded-md border bg-card transition-all',
          'cursor-pointer hover:shadow-md',
          isCurrentBlock && 'ring-2 ring-primary ring-offset-2',
          hasErrors && 'border-destructive/50',
        )}
      >
        {/* Top bar */}
        <div className={cn('h-0.75 w-full shrink-0', metadata.topBarColor)} />

        {/* Content */}
        <div className="flex flex-1 items-center justify-between px-2">
          <span className="truncate text-xs font-medium">{truncatedTitle}</span>

          {/* Validation icon */}
          {hasErrors ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
          ) : (
            <Check className="h-3 w-3 shrink-0 text-green-500" />
          )}
        </div>
      </button>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="h-2! w-2! border! border-border! bg-background!"
        style={{ right: 8 }}
      />

      {/* Node controls */}
      <NodeControls
        nodeId={instanceId}
        kind={kind}
        parentOptions={parentOptions}
        childOptions={childOptions}
        siblingOptions={siblingOptions}
        existingParents={existingParents}
        existingChildren={existingChildren}
        existingSiblings={existingSiblings}
        onAddBlock={onAddBlock}
        onNavigate={onNavigate}
        isCurrentBlock={isCurrentBlock}
      />
    </div>
  )
})
