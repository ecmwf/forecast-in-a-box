/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyPlus,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { ConnectionsPanel } from './ConnectionsPanel'
import type {
  BlockFactoryCatalogue,
  BlockInstanceId,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import {
  useBlockValidation,
  useFableBuilderStore,
} from '@/features/fable-builder/stores/fableBuilderStore'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { FieldRenderer } from '@/components/base/fields'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BLOCK_KIND_METADATA,
  getBlockKindIcon,
  getFactory,
} from '@/api/types/fable.types'
import { cn } from '@/lib/utils'

interface BlockInstanceCardProps {
  instanceId: BlockInstanceId
  catalogue: BlockFactoryCatalogue
  isSelected?: boolean
  onAddConnectedBlock?: (
    factoryId: PluginBlockFactoryId,
    sourceBlockId: BlockInstanceId,
  ) => void
  onBlockClick?: (blockId: BlockInstanceId) => void
}

export function BlockInstanceCard({
  instanceId,
  catalogue,
  isSelected = false,
  onAddConnectedBlock,
  onBlockClick,
}: BlockInstanceCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  const fable = useFableBuilderStore((state) => state.fable)
  const updateBlockConfig = useFableBuilderStore(
    (state) => state.updateBlockConfig,
  )
  const removeBlock = useFableBuilderStore((state) => state.removeBlock)
  const duplicateBlock = useFableBuilderStore((state) => state.duplicateBlock)
  const duplicateBlockWithChildren = useFableBuilderStore(
    (state) => state.duplicateBlockWithChildren,
  )
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const disconnectBlock = useFableBuilderStore((state) => state.disconnectBlock)
  const blockValidation = useBlockValidation(instanceId)

  const instance = fable.blocks[instanceId]
  const factory = getFactory(catalogue, instance.factory_id)

  // Compute available sources that can be connected to this block's inputs
  const availableSources = useMemo(() => {
    return Object.entries(fable.blocks)
      .filter(([id, block]) => {
        if (id === instanceId) return false
        const blockFactory = getFactory(catalogue, block.factory_id)
        // Only source and product blocks can be inputs
        return (
          blockFactory?.kind === 'source' || blockFactory?.kind === 'product'
        )
      })
      .map(([id, block]) => ({
        id,
        block,
        factory: getFactory(catalogue, block.factory_id),
      }))
  }, [fable.blocks, instanceId, catalogue])

  if (!factory) {
    return null
  }

  const metadata = BLOCK_KIND_METADATA[factory.kind]
  const IconComponent = getBlockKindIcon(factory.kind)
  const hasErrors = blockValidation?.hasErrors ?? false
  const errors = blockValidation?.errors ?? []

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Card
          className={cn(
            'transition-all',
            hasErrors && 'border-destructive',
            isSelected && 'ring-2 ring-primary ring-offset-2',
          )}
        >
          <CardHeader className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn('rounded p-1.5', metadata.bgColor)}>
                  <IconComponent className={cn('h-4 w-4', metadata.color)} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{factory.title}</span>
                    {hasErrors && (
                      <Badge variant="destructive" className="gap-1 text-sm">
                        <AlertCircle className="h-3 w-3" />
                        Has errors
                      </Badge>
                    )}
                  </div>
                  <P className="text-muted-foreground">{factory.description}</P>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>

                <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                  <PopoverTrigger
                    render={
                      <Button variant="ghost" size="icon" className="h-8 w-8" />
                    }
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="end">
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      onClick={() => {
                        duplicateBlock(instanceId)
                        setMenuOpen(false)
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      Duplicate
                    </button>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      onClick={() => {
                        duplicateBlockWithChildren(instanceId)
                        setMenuOpen(false)
                      }}
                    >
                      <CopyPlus className="h-4 w-4" />
                      Duplicate with children
                    </button>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      onClick={() => {
                        alert(
                          'Coming soon: Saving configurations as presets will be available soon.',
                        )
                        setMenuOpen(false)
                      }}
                    >
                      <Bookmark className="h-4 w-4" />
                      Save config as preset
                    </button>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>

          {isExpanded && (
            <CardContent className="border-t px-4 py-3">
              {hasErrors && (
                <div className="mb-4 rounded-md bg-destructive/10 p-3 text-destructive">
                  <P className="mb-1 font-medium">Configuration Issues</P>
                  <ul className="list-disc space-y-0.5 pl-4 text-sm">
                    {errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {factory.inputs.length > 0 && (
                <div className="mb-4 border-b pb-4">
                  <P className="mb-3 font-medium">Input Connections</P>
                  <div className="space-y-3">
                    {factory.inputs.map((inputName) => {
                      const connectedTo = instance.input_ids[inputName]
                      const connectedBlock = connectedTo
                        ? fable.blocks[connectedTo]
                        : undefined
                      const connectedFactory = connectedBlock
                        ? getFactory(catalogue, connectedBlock.factory_id)
                        : null

                      // Compute display value for the Select
                      const displayValue = connectedFactory
                        ? connectedFactory.title
                        : 'Select source...'

                      return (
                        <div key={inputName} className="space-y-1.5">
                          <Label
                            htmlFor={`${instanceId}-input-${inputName}`}
                            className="text-sm"
                          >
                            {inputName}
                          </Label>
                          <Select
                            value={connectedTo || undefined}
                            onValueChange={(value) => {
                              if (value) {
                                connectBlocks(instanceId, inputName, value)
                              } else {
                                disconnectBlock(instanceId, inputName)
                              }
                            }}
                          >
                            <SelectTrigger
                              id={`${instanceId}-input-${inputName}`}
                              className="h-9 w-full"
                            >
                              <SelectValue>{displayValue}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {availableSources.length > 0 ? (
                                availableSources.map(
                                  ({ id, factory: sourceFactory }) => (
                                    <SelectItem key={id} value={id}>
                                      {sourceFactory?.title || id}
                                    </SelectItem>
                                  ),
                                )
                              ) : (
                                <div className="p-2 text-sm text-muted-foreground">
                                  No compatible sources available
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {Object.keys(factory.configuration_options).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(factory.configuration_options).map(
                    ([key, option]) => (
                      <FieldRenderer
                        key={key}
                        id={`${instanceId}-${key}`}
                        valueType={option.value_type}
                        value={instance.configuration_values[key] ?? ''}
                        onChange={(value) =>
                          updateBlockConfig(instanceId, key, value)
                        }
                        label={option.title}
                        description={option.description}
                      />
                    ),
                  )}
                </div>
              ) : (
                <P className="py-2 text-center text-muted-foreground">
                  No configuration options
                </P>
              )}
            </CardContent>
          )}

          {/* Pipeline Flow Panel - always visible, collapsible */}
          <ConnectionsPanel
            instanceId={instanceId}
            catalogue={catalogue}
            onBlockClick={onBlockClick}
            onAddConnectedBlock={onAddConnectedBlock}
          />
        </Card>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onClick={() => duplicateBlock(instanceId)}
          className="gap-2"
        >
          <Copy className="h-4 w-4" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => duplicateBlockWithChildren(instanceId)}
          className="gap-2"
        >
          <CopyPlus className="h-4 w-4" />
          Duplicate with children
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            alert(
              'Coming soon: Saving configurations as presets will be available soon.',
            )
          }
          className="gap-2"
        >
          <Bookmark className="h-4 w-4" />
          Save config as preset
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => setDeleteDialogOpen(true)}
          className="gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Delete block
        </ContextMenuItem>
      </ContextMenuContent>

      {/* Delete confirmation dialog - triggered from context menu */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Block</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{factory.title}"? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeBlock(instanceId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContextMenu>
  )
}
