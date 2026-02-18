/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo, useMemo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { AlertCircle, Trash2 } from 'lucide-react'

import type { Node, NodeProps } from '@xyflow/react'
import type { FableNodeData } from '@/features/fable-builder/utils/fable-to-graph'
import type { BlockFactory, BlockInstance } from '@/api/types/fable.types'
import { AddNodeButton } from '@/features/fable-builder/components/graph-mode/AddNodeButton'
import { useNodeDimensions } from '@/features/fable-builder/hooks/useNodeDimensions'
import {
  useBlockValidation,
  useFableBuilderStore,
} from '@/features/fable-builder/stores/fableBuilderStore'
import { H3, P } from '@/components/base/typography'
import {
  BLOCK_KIND_METADATA,
  getBlockKindIcon,
  getFactory,
} from '@/api/types/fable.types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { FieldRenderer } from '@/components/base/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type FableNode = Node<FableNodeData>

export const InlineBlockNode = memo(function InlineBlockNode({
  id,
  data,
  selected,
}: NodeProps<FableNode>) {
  const { factory, instance, catalogue } = data
  const metadata = BLOCK_KIND_METADATA[factory.kind]
  const IconComponent = getBlockKindIcon(factory.kind)

  const containerRef = useNodeDimensions(id)
  const selectedBlockId = useFableBuilderStore((state) => state.selectedBlockId)
  const selectBlock = useFableBuilderStore((state) => state.selectBlock)
  const fable = useFableBuilderStore((state) => state.fable)
  const validationState = useFableBuilderStore((state) => state.validationState)
  const updateBlockConfig = useFableBuilderStore(
    (state) => state.updateBlockConfig,
  )
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const disconnectBlock = useFableBuilderStore((state) => state.disconnectBlock)
  const removeBlockCascade = useFableBuilderStore(
    (state) => state.removeBlockCascade,
  )
  const blockValidation = useBlockValidation(id)

  const isSelected = selected || selectedBlockId === id
  const hasErrors = blockValidation?.hasErrors ?? false
  const errors = blockValidation?.errors ?? []
  const possibleExpansions =
    validationState?.blockStates[id]?.possibleExpansions ?? []

  const availableSources = useMemo(() => {
    const sources: Array<{
      id: string
      block: BlockInstance
      factory: BlockFactory
    }> = []

    for (const [blockId, block] of Object.entries(fable.blocks)) {
      if (blockId === id) continue
      const blockFactory = getFactory(catalogue, block.factory_id)
      if (
        blockFactory &&
        (blockFactory.kind === 'source' || blockFactory.kind === 'product')
      ) {
        sources.push({ id: blockId, block, factory: blockFactory })
      }
    }

    return sources
  }, [fable.blocks, id, catalogue])

  function handleInputChange(inputName: string, sourceId: string): void {
    if (sourceId === '') {
      disconnectBlock(id, inputName)
    } else {
      connectBlocks(id, inputName, sourceId)
    }
  }

  const configOptions = Object.entries(factory.configuration_options)
  const inputs = factory.inputs

  return (
    <div
      ref={containerRef}
      onClick={() => selectBlock(id)}
      className={cn(
        'relative w-[380px] rounded-2xl border bg-card shadow-sm',
        'cursor-pointer transition-all duration-300 hover:shadow-lg',
        isSelected &&
          'shadow-[0_0_0_2px_rgba(18,69,222,1),0_15px_35px_-5px_rgba(18,69,222,0.15)]',
        hasErrors &&
          !isSelected &&
          'shadow-[0_0_0_2px_rgba(220,38,38,1),0_15px_35px_-5px_rgba(220,38,38,0.15)]',
      )}
    >
      {hasErrors && (
        <Tooltip>
          <TooltipTrigger className="absolute -top-2 -right-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <AlertCircle className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-75">
            <div className="space-y-1">
              <P className="font-medium text-destructive">Validation Errors</P>
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      <div
        className={cn(
          'h-1.5 w-full rounded-t-2xl opacity-80',
          metadata.topBarColor,
        )}
      />

      <div className="p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <IconComponent className={cn('h-5 w-5', metadata.color)} />
            <span className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              {metadata.label}
            </span>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="nodrag h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <Trash2 className="h-4 w-4" />
            </AlertDialogTrigger>
            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Block</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{factory.title}" and all
                  connected downstream blocks? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => removeBlockCascade(id)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <H3 className="mb-1 text-base font-semibold text-foreground">
          {factory.title}
        </H3>

        {factory.description && (
          <P className="mb-4 line-clamp-2 text-muted-foreground">
            {factory.description}
          </P>
        )}

        {inputs.length > 0 && (
          <div className="mb-4 space-y-2">
            <Separator />
            <div className="text-sm font-medium text-muted-foreground">
              Inputs
            </div>
            {inputs.map((inputName) => {
              const currentSourceId = instance.input_ids[inputName] || ''

              return (
                <div
                  key={inputName}
                  className="nodrag space-y-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Label
                    htmlFor={`input-${id}-${inputName}`}
                    className="text-sm"
                  >
                    {inputName}
                  </Label>
                  <Select
                    value={currentSourceId || undefined}
                    onValueChange={(value) =>
                      handleInputChange(inputName, value ?? '')
                    }
                  >
                    <SelectTrigger
                      id={`input-${id}-${inputName}`}
                      className="h-8 text-sm"
                    >
                      <SelectValue>
                        {currentSourceId
                          ? (availableSources.find(
                              (s) => s.id === currentSourceId,
                            )?.factory.title ?? currentSourceId)
                          : 'Select source...'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {availableSources.map(
                        ({ id: sourceId, factory: sourceFactory }) => (
                          <SelectItem key={sourceId} value={sourceId}>
                            {sourceFactory.title}
                          </SelectItem>
                        ),
                      )}
                      {availableSources.length === 0 && (
                        <div className="p-2 text-sm text-muted-foreground">
                          No compatible sources
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
        )}

        {configOptions.length > 0 && (
          <div className="space-y-3">
            {inputs.length > 0 && <Separator />}
            <div className="text-sm font-medium text-muted-foreground">
              Configuration
            </div>
            {configOptions.map(([key, option]) => (
              <div
                key={key}
                className="nodrag space-y-1"
                onClick={(e) => e.stopPropagation()}
              >
                <FieldRenderer
                  id={`config-${id}-${key}`}
                  valueType={option.value_type}
                  value={instance.configuration_values[key] || ''}
                  onChange={(value) => updateBlockConfig(id, key, value)}
                  label={option.title || key}
                  description={option.description}
                  inputClassName="h-8 text-sm"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {inputs.map((inputName, index) => {
        const isConnected = Boolean(instance.input_ids[inputName])
        const topPercent = ((index + 1) / (inputs.length + 1)) * 100

        return (
          <Handle
            key={inputName}
            type="target"
            position={Position.Left}
            id={inputName}
            title={inputName}
            className={cn(
              '-left-2.5! h-5! w-5! rounded-full! border-4! bg-card!',
              isConnected
                ? 'border-primary!'
                : 'border-muted-foreground/30! hover:border-muted-foreground/50!',
              'transition-all hover:scale-110',
            )}
            style={{
              top: `${topPercent}%`,
              transform: 'translateY(-50%)',
            }}
          />
        )
      })}

      {factory.kind !== 'sink' && (
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          title="Output"
          className={cn(
            '-right-2.5! h-5! w-5! rounded-full! border-4! bg-card!',
            metadata.handleColor,
            'transition-all hover:scale-110',
          )}
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        />
      )}

      {factory.kind !== 'sink' && (
        <AddNodeButton
          sourceBlockId={id}
          possibleExpansions={possibleExpansions}
          catalogue={catalogue}
        />
      )}
    </div>
  )
})
