/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  getBlocksByKind,
} from '@/api/types/fable.types'
import { useUpsertFable } from '@/api/hooks/useFable'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { showToast } from '@/lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface FableBlockSummary {
  source: number
  transform: number
  product: number
  sink: number
}

export interface FableSaveMetadata {
  title: string
  comments: string
  summary: FableBlockSummary
  savedAt: string
  isFavourite?: boolean
}

export type FableMetadataStore = Record<string, FableSaveMetadata>

function computeBlockSummary(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): FableBlockSummary {
  return {
    source: getBlocksByKind(fable, catalogue, 'source').length,
    transform: getBlocksByKind(fable, catalogue, 'transform').length,
    product: getBlocksByKind(fable, catalogue, 'product').length,
    sink: getBlocksByKind(fable, catalogue, 'sink').length,
  }
}

export function BlockSummaryBadges({
  summary,
  className,
}: {
  summary: FableBlockSummary
  className?: string
}) {
  return (
    <div className={className ?? 'flex flex-wrap gap-1.5'}>
      {BLOCK_KIND_ORDER.filter(
        (kind) => summary[kind as keyof FableBlockSummary] > 0,
      ).map((kind) => {
        const meta = BLOCK_KIND_METADATA[kind]
        const count = summary[kind as keyof FableBlockSummary]
        return (
          <Badge key={kind} variant="outline" className="gap-1.5 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${meta.topBarColor}`}
            />
            {count} {meta.label.toLowerCase()}
            {count !== 1 ? 's' : ''}
          </Badge>
        )
      })}
    </div>
  )
}

function generateDefaultTitle(): string {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().slice(0, 5)
  return `Forecast Config ${date} ${time}`
}

interface SaveConfigPopoverProps {
  fableId?: string
  catalogue: BlockFactoryCatalogue
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SaveConfigPopover({
  fableId,
  catalogue,
  disabled,
  open,
  onOpenChange,
}: SaveConfigPopoverProps) {
  const fable = useFableBuilderStore((s) => s.fable)
  const storeFableId = useFableBuilderStore((s) => s.fableId)
  const markSaved = useFableBuilderStore((s) => s.markSaved)

  const upsertFable = useUpsertFable()
  const [metadataStore, setMetadataStore] = useLocalStorage<FableMetadataStore>(
    STORAGE_KEYS.fable.metadata,
    {},
  )

  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = isControlled ? open : internalOpen

  const effectiveFableId = fableId ?? storeFableId
  const isUpdate = !!effectiveFableId

  const [title, setTitle] = useState(generateDefaultTitle)
  const [comments, setComments] = useState('')

  const summary = computeBlockSummary(fable, catalogue)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setTitle(generateDefaultTitle())
      setComments('')
    }
    if (isControlled) {
      onOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
  }

  async function handleSave(asCopy: boolean = false) {
    try {
      const idToPass = asCopy ? undefined : (effectiveFableId ?? undefined)
      const newId = await upsertFable.mutateAsync({
        fable,
        fableId: idToPass,
      })
      const displayTitle = title.trim() || generateDefaultTitle()

      setMetadataStore({
        ...metadataStore,
        [newId]: {
          title: displayTitle,
          comments: comments.trim(),
          summary,
          savedAt: new Date().toISOString(),
        },
      })

      markSaved(newId, displayTitle)
      handleOpenChange(false)
      showToast.success(
        asCopy ? 'Configuration saved as new' : 'Configuration saved',
      )
    } catch (error) {
      showToast.error(
        'Failed to save configuration',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {isControlled ? (
        <PopoverTrigger render={<span className="hidden" />} />
      ) : (
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || upsertFable.isPending}
              className="gap-2"
            />
          }
        >
          {upsertFable.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isUpdate ? 'Update Config' : 'Save Config'}
        </PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>
            {isUpdate ? 'Update Configuration' : 'Save Configuration'}
          </PopoverTitle>
        </PopoverHeader>

        {/* Block summary */}
        <BlockSummaryBadges summary={summary} />

        {/* Title input */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="save-config-title">Title</Label>
          <Input
            id="save-config-title"
            placeholder="e.g. European forecast run"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Comments textarea */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="save-config-comments">Comments</Label>
          <textarea
            id="save-config-comments"
            rows={2}
            placeholder="Optional notes about this configuration..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          {isUpdate && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(true)}
              disabled={upsertFable.isPending}
            >
              Save as New
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => handleSave(false)}
            disabled={upsertFable.isPending}
          >
            {upsertFable.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            {isUpdate ? 'Update' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
