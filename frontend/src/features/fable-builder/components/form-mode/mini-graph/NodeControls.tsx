/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Plus } from 'lucide-react'
import type {
  BlockInstanceId,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type ControlDirection = 'parent' | 'child' | 'sibling'

interface ControlOption {
  factoryId: PluginBlockFactoryId
  title: string
}

interface ExistingBlock {
  id: BlockInstanceId
  title: string
}

interface NodeControlButtonProps {
  direction: ControlDirection
  addOptions: Array<ControlOption>
  existingBlocks: Array<ExistingBlock>
  onAddBlock: (
    factoryId: PluginBlockFactoryId,
    direction: ControlDirection,
  ) => void
  onNavigate: (blockId: BlockInstanceId) => void
  kind: BlockKind
}

function NodeControlButton({
  direction,
  addOptions,
  existingBlocks,
  onAddBlock,
  onNavigate,
  kind,
}: NodeControlButtonProps) {
  const hasOptions = addOptions.length > 0 || existingBlocks.length > 0

  if (!hasOptions) return null

  const directionLabels: Record<ControlDirection, string> = {
    parent: 'upstream',
    child: 'downstream',
    sibling: kind,
  }

  // Stop propagation wrapper to prevent React Flow from capturing events
  const stopPropagation = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation()
  }

  return (
    <div
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm',
            'transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground',
            'focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:outline-none',
          )}
        >
          <Plus className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-40">
          {addOptions.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                Add new {directionLabels[direction]}
              </DropdownMenuLabel>
              {addOptions.map((option) => (
                <DropdownMenuItem
                  key={`${option.factoryId.plugin.store}/${option.factoryId.plugin.local}:${option.factoryId.factory}`}
                  onClick={() => onAddBlock(option.factoryId, direction)}
                >
                  {option.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
          {addOptions.length > 0 && existingBlocks.length > 0 && (
            <DropdownMenuSeparator />
          )}
          {existingBlocks.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Jump to existing</DropdownMenuLabel>
              {existingBlocks.map((block) => (
                <DropdownMenuItem
                  key={block.id}
                  onClick={() => onNavigate(block.id)}
                >
                  {block.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export interface NodeControlsProps {
  nodeId: BlockInstanceId
  kind: BlockKind
  parentOptions: Array<ControlOption>
  childOptions: Array<ControlOption>
  siblingOptions: Array<ControlOption>
  existingParents: Array<ExistingBlock>
  existingChildren: Array<ExistingBlock>
  existingSiblings: Array<ExistingBlock>
  onAddBlock: (
    factoryId: PluginBlockFactoryId,
    direction: ControlDirection,
  ) => void
  onNavigate: (blockId: BlockInstanceId) => void
  isCurrentBlock?: boolean
}

/**
 * Contextual add/navigate controls rendered around a node.
 * These are positioned absolutely relative to the node container.
 */
export function NodeControls({
  kind,
  parentOptions,
  childOptions,
  siblingOptions,
  existingParents,
  existingChildren,
  existingSiblings,
  onAddBlock,
  onNavigate,
}: NodeControlsProps) {
  const showParent = parentOptions.length > 0 || existingParents.length > 0
  const showChild = childOptions.length > 0 || existingChildren.length > 0
  const showSibling = siblingOptions.length > 0 || existingSiblings.length > 0

  // Always show controls for all nodes
  const containerClass = 'absolute inset-0 pointer-events-none'

  return (
    <div className={containerClass}>
      {/* Left: Parent control */}
      {showParent && (
        <div className="pointer-events-auto absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2">
          <NodeControlButton
            direction="parent"
            addOptions={parentOptions}
            existingBlocks={existingParents}
            onAddBlock={onAddBlock}
            onNavigate={onNavigate}
            kind={kind}
          />
        </div>
      )}

      {/* Right: Child control */}
      {showChild && (
        <div className="pointer-events-auto absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2">
          <NodeControlButton
            direction="child"
            addOptions={childOptions}
            existingBlocks={existingChildren}
            onAddBlock={onAddBlock}
            onNavigate={onNavigate}
            kind={kind}
          />
        </div>
      )}

      {/* Bottom: Sibling control */}
      {showSibling && (
        <div className="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
          <NodeControlButton
            direction="sibling"
            addOptions={siblingOptions}
            existingBlocks={existingSiblings}
            onAddBlock={onAddBlock}
            onNavigate={onNavigate}
            kind={kind}
          />
        </div>
      )}
    </div>
  )
}
