/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { AlertCircle, Link2, Trash2, X } from 'lucide-react'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  BLOCK_KIND_METADATA,
  getBlockKindIcon,
  getFactory,
} from '@/api/types/fable.types'
import { H2, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FieldRenderer } from '@/components/base/fields'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ConfigPanelProps {
  catalogue: BlockFactoryCatalogue
}

export function ConfigPanel({ catalogue }: ConfigPanelProps): React.ReactNode {
  // Use individual selectors to avoid creating new objects on every render
  const selectedBlockId = useFableBuilderStore((state) => state.selectedBlockId)
  const fable = useFableBuilderStore((state) => state.fable)
  const selectBlock = useFableBuilderStore((state) => state.selectBlock)
  const updateBlockConfig = useFableBuilderStore(
    (state) => state.updateBlockConfig,
  )
  const removeBlock = useFableBuilderStore((state) => state.removeBlock)
  const connectBlocks = useFableBuilderStore((state) => state.connectBlocks)
  const disconnectBlock = useFableBuilderStore((state) => state.disconnectBlock)

  const selectedBlock = selectedBlockId ? fable.blocks[selectedBlockId] : null
  const factory = selectedBlock
    ? getFactory(catalogue, selectedBlock.factory_id)
    : null

  const availableSources = useMemo(() => {
    if (!selectedBlockId) return []

    return Object.entries(fable.blocks)
      .filter(([id, block]) => {
        if (id === selectedBlockId) return false
        const blockFactory = getFactory(catalogue, block.factory_id)
        return (
          blockFactory?.kind === 'source' || blockFactory?.kind === 'product'
        )
      })
      .map(([id, block]) => ({
        id,
        block,
        factory: getFactory(catalogue, block.factory_id),
      }))
  }, [fable.blocks, selectedBlockId, catalogue])

  function handleConfigChange(key: string, value: string): void {
    if (!selectedBlockId) return
    updateBlockConfig(selectedBlockId, key, value)
  }

  function handleInputChange(inputName: string, sourceId: string): void {
    if (!selectedBlockId) return
    if (sourceId === '') {
      disconnectBlock(selectedBlockId, inputName)
    } else {
      connectBlocks(selectedBlockId, inputName, sourceId)
    }
  }

  function handleDelete(): void {
    if (!selectedBlockId) return
    removeBlock(selectedBlockId)
    selectBlock(null)
  }

  if (!selectedBlock || !factory) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="text-muted-foreground">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <P>Select a block to configure</P>
        </div>
      </div>
    )
  }

  const metadata = BLOCK_KIND_METADATA[factory.kind]
  const IconComponent = getBlockKindIcon(factory.kind)
  const configOptions = Object.entries(factory.configuration_options)
  const inputs = factory.inputs

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className={cn('shrink-0', metadata.color)}>
              <IconComponent className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <H2 className="truncate text-sm font-semibold">
                {factory.title}
              </H2>
              <Badge variant="outline" className="mt-1 text-sm">
                {metadata.label}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => selectBlock(null)}
            data-testid="config-panel-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {factory.description && (
          <P className="mt-2 text-muted-foreground">{factory.description}</P>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {inputs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4" />
              Input Connections
            </div>
            <div className="space-y-3">
              {inputs.map((inputName) => (
                <InputConnectionField
                  key={inputName}
                  inputName={inputName}
                  currentSourceId={selectedBlock.input_ids[inputName] || ''}
                  availableSources={availableSources}
                  onInputChange={handleInputChange}
                />
              ))}
            </div>
            <Separator />
          </div>
        )}

        {configOptions.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Configuration</div>
            <div className="space-y-4">
              {configOptions.map(([key, option]) => (
                <FieldRenderer
                  key={key}
                  id={`config-${key}`}
                  valueType={option.value_type}
                  value={selectedBlock.configuration_values[key] || ''}
                  onChange={(value) => handleConfigChange(key, value)}
                  label={option.title || key}
                  description={option.description}
                  inputClassName="h-9"
                />
              ))}
            </div>
          </div>
        )}

        {configOptions.length === 0 && inputs.length === 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No configuration options
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="destructive"
                size="sm"
                className="w-full gap-2"
              />
            }
          >
            <Trash2 className="h-4 w-4" />
            Delete Block
          </AlertDialogTrigger>
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
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

interface AvailableSource {
  id: string
  factory: { title?: string } | undefined
}

interface InputConnectionFieldProps {
  inputName: string
  currentSourceId: string
  availableSources: Array<AvailableSource>
  onInputChange: (inputName: string, sourceId: string) => void
}

function InputConnectionField({
  inputName,
  currentSourceId,
  availableSources,
  onInputChange,
}: InputConnectionFieldProps): React.ReactNode {
  const displayValue = currentSourceId
    ? availableSources.find((s) => s.id === currentSourceId)?.factory?.title ||
      currentSourceId
    : 'Select source...'

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`input-${inputName}`} className="text-sm">
        {inputName}
      </Label>
      <Select
        value={currentSourceId || undefined}
        onValueChange={(value) => onInputChange(inputName, value ?? '')}
      >
        <SelectTrigger id={`input-${inputName}`} className="h-9 w-full">
          <SelectValue>{displayValue}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {availableSources.map(({ id, factory: sourceFactory }) => (
            <SelectItem key={id} value={id}>
              {sourceFactory?.title || id}
            </SelectItem>
          ))}
          {availableSources.length === 0 && (
            <div className="p-2 text-sm text-muted-foreground">
              No compatible sources
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
