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
import { Plus } from 'lucide-react'
import type { Node, NodeProps } from '@xyflow/react'
import type { BlockKind, PluginBlockFactoryId } from '@/api/types/fable.types'
import { BLOCK_KIND_METADATA } from '@/api/types/fable.types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface AddOption {
  factoryId: PluginBlockFactoryId
  title: string
}

export interface AddBlockNodeData extends Record<string, unknown> {
  kind: BlockKind
  addOptions: Array<AddOption>
  onAddBlock: (factoryId: PluginBlockFactoryId) => void
}

export type AddBlockNodeType = Node<AddBlockNodeData>

/**
 * Standalone "Add" node for empty stages (no existing blocks).
 * Same dimensions as MiniPipelineNode with:
 * - Dashed border
 * - Plus icon + "Add [Kind]" text
 * - onClick → dropdown to select block type
 */
export const AddBlockNode = memo(function AddBlockNode({
  data,
}: NodeProps<AddBlockNodeType>) {
  const { kind, addOptions, onAddBlock } = data

  const metadata = BLOCK_KIND_METADATA[kind]

  if (addOptions.length === 0) {
    return null
  }

  return (
    <div className="relative">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="h-2! w-2! border! border-border! bg-background!"
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex h-9 w-25 items-center justify-center gap-1.5 rounded-md border-2 border-dashed bg-card/50',
            'text-muted-foreground transition-colors',
            'hover:border-primary/50 hover:bg-muted/50 hover:text-foreground',
            'focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:outline-none',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-xs">Add {metadata.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {addOptions.map((option) => (
            <DropdownMenuItem
              key={`${option.factoryId.plugin.store}/${option.factoryId.plugin.local}:${option.factoryId.factory}`}
              onClick={() => onAddBlock(option.factoryId)}
            >
              {option.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="h-2! w-2! border! border-border! bg-background!"
      />
    </div>
  )
})
