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
import { useTranslation } from 'react-i18next'
import { Loader2, Save, X } from 'lucide-react'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import {
  BLOCK_KIND_METADATA,
  BLOCK_KIND_ORDER,
  getBlocksByKind,
} from '@/api/types/fable.types'
import { ApiClientError } from '@/api/client'
import { useFableRetrieve, useUpsertFable } from '@/api/hooks/useFable'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
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

interface FableBlockSummary {
  source: number
  transform: number
  product: number
  sink: number
}

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

function generateDefaultTitleParts(): { date: string; time: string } {
  const now = new Date()
  return {
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().slice(0, 5),
  }
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
  const { t } = useTranslation(['configure', 'common'])
  const fable = useFableBuilderStore((s) => s.fable)
  const storeFableId = useFableBuilderStore((s) => s.fableId)
  const storeFableVersion = useFableBuilderStore((s) => s.fableVersion)
  const markSaved = useFableBuilderStore((s) => s.markSaved)

  const upsertFable = useUpsertFable()

  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = isControlled ? open : internalOpen

  const effectiveFableId = fableId ?? storeFableId
  const isUpdate = !!effectiveFableId
  const { data: fableData } = useFableRetrieve(effectiveFableId)

  const generateDefaultTitle = () =>
    t('configure:save.defaultTitle', generateDefaultTitleParts())

  const [title, setTitle] = useState(generateDefaultTitle)
  const [comments, setComments] = useState('')
  const [tags, setTags] = useState<Array<string>>([])
  const [tagInput, setTagInput] = useState('')

  const summary = computeBlockSummary(fable, catalogue)

  function addTag(value: string) {
    const trimmed = value.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
    }
  }

  function handleTagChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value.includes(',')) {
      const parts = value.split(',')
      for (const part of parts.slice(0, -1)) {
        addTag(part)
      }
      setTagInput(parts[parts.length - 1])
    } else {
      setTagInput(value)
    }
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      addTag(tagInput)
      setTagInput('')
    }
    if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  function handleRemoveTag(tag: string) {
    setTags(tags.filter((existing) => existing !== tag))
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setTitle(
        fableData?.display_name ||
          t('configure:save.defaultTitle', generateDefaultTitleParts()),
      )
      setComments(fableData?.display_description || '')
      setTags(fableData?.tags ? [...fableData.tags] : [])
      setTagInput('')
    }
    if (isControlled) {
      onOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
  }

  async function handleSave(asCopy: boolean = false) {
    try {
      const isExistingUpdate = !asCopy && !!effectiveFableId
      const displayTitle =
        title.trim() ||
        t('configure:save.defaultTitle', generateDefaultTitleParts())
      // Include any pending text in the input as a final tag
      const finalTags = [...tags]
      const pendingTag = tagInput.trim()
      if (pendingTag && !finalTags.includes(pendingTag)) {
        finalTags.push(pendingTag)
      }
      const result = await upsertFable.mutateAsync({
        fable,
        // Update: pass ID + version for in-place update
        // Save as New: pass ID as parentId for lineage tracking
        fableId: isExistingUpdate ? effectiveFableId : undefined,
        fableVersion: isExistingUpdate
          ? (storeFableVersion ?? fableData?.version)
          : undefined,
        parentId: asCopy ? (effectiveFableId ?? undefined) : undefined,
        display_name: displayTitle,
        display_description: comments.trim(),
        tags: finalTags,
      })

      markSaved(result.blueprint_id, result.version, displayTitle)
      handleOpenChange(false)
      showToast.success(
        asCopy ? t('configure:save.savedAsNew') : t('configure:save.saved'),
      )
    } catch (error) {
      let description: string
      if (
        error instanceof ApiClientError &&
        error.status === 422 &&
        error.details
      ) {
        const detail = error.details as {
          global_errors?: Array<string>
          block_errors?: Record<string, Array<string>>
        }
        const messages = [
          ...(detail.global_errors ?? []),
          ...Object.values(detail.block_errors ?? {}).flat(),
        ]
        description = messages.join('; ') || error.message
      } else {
        description = error instanceof Error ? error.message : String(error)
      }
      showToast.error(t('configure:save.saveFailed'), description)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {isControlled ? (
        <PopoverTrigger
          nativeButton={false}
          render={<span className="hidden" />}
        />
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
          {isUpdate
            ? t('configure:save.triggerUpdate')
            : t('configure:save.triggerSave')}
        </PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>
            {isUpdate
              ? t('configure:save.titleUpdate')
              : t('configure:save.titleSave')}
          </PopoverTitle>
        </PopoverHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSave(false)
          }}
        >
          {/* Block summary */}
          <BlockSummaryBadges summary={summary} />

          {/* Title input */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-config-title">
              {t('configure:save.titleLabel')}
            </Label>
            <Input
              id="save-config-title"
              placeholder={t('configure:save.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Comments textarea */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-config-comments">
              {t('configure:save.commentsLabel')}
            </Label>
            <textarea
              id="save-config-comments"
              rows={2}
              placeholder={t('configure:save.commentsPlaceholder')}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          {/* Tags input */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-config-tags">
              {t('configure:save.tagsLabel')}
            </Label>
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="shrink-0 gap-1 py-0.5"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-0.5 rounded-full hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                id="save-config-tags"
                placeholder={
                  tags.length === 0 ? t('configure:save.tagsPlaceholder') : ''
                }
                value={tagInput}
                onChange={handleTagChange}
                onKeyDown={handleTagKeyDown}
                className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              {t('common:cancel')}
            </Button>
            {isUpdate && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSave(true)}
                disabled={upsertFable.isPending}
              >
                {t('configure:save.saveAsNew')}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={upsertFable.isPending}>
              {upsertFable.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {isUpdate ? t('configure:save.update') : t('configure:save.save')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
