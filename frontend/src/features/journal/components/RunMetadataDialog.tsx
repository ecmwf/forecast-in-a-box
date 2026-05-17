/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Dialog to edit a run blueprint's metadata — name, description, user tags. */

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KeyboardEvent } from 'react'
import type { FableRetrieveResponse } from '@/api/types/fable.types'
import { useUpsertFable } from '@/api/hooks/useFable'
import {
  isOneoffBlueprint,
  stripSystemTags,
  withOneoffTag,
} from '@/lib/system-tags'
import { showToast } from '@/lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface RunMetadataDialogProps {
  /** The run's blueprint — undefined until it loads. */
  blueprint: FableRetrieveResponse | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RunMetadataDialog({
  blueprint,
  open,
  onOpenChange,
}: RunMetadataDialogProps) {
  const { t } = useTranslation('journal')
  const upsertFable = useUpsertFable()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<Array<string>>([])
  const [tagDraft, setTagDraft] = useState('')

  // Seed the form from the blueprint each time the dialog opens.
  useEffect(() => {
    if (open && blueprint) {
      setName(blueprint.display_name ?? '')
      setDescription(blueprint.display_description ?? '')
      setTags(stripSystemTags(blueprint.tags))
      setTagDraft('')
    }
  }, [open, blueprint])

  function addTag(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    // Functional update so a comma-split loop adds every part, not just the last.
    setTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
  }

  /** A comma (typed or pasted) commits every part but the last. */
  function handleTagChange(value: string) {
    if (!value.includes(',')) {
      setTagDraft(value)
      return
    }
    const parts = value.split(',')
    for (const part of parts.slice(0, -1)) addTag(part)
    setTagDraft(parts[parts.length - 1] ?? '')
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addTag(tagDraft)
      setTagDraft('')
    } else if (event.key === 'Backspace' && !tagDraft && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  async function handleSave() {
    if (!blueprint) return
    const trimmedDraft = tagDraft.trim()
    const finalTags =
      trimmedDraft && !tags.includes(trimmedDraft)
        ? [...tags, trimmedDraft]
        : tags
    try {
      await upsertFable.mutateAsync({
        fable: blueprint.builder,
        fableId: blueprint.blueprint_id,
        fableVersion: blueprint.version,
        display_name: name.trim() || (blueprint.display_name ?? ''),
        display_description: description.trim(),
        // Keep the one-off marker — editing details must not promote a run to a preset.
        tags: isOneoffBlueprint(blueprint.tags)
          ? withOneoffTag(finalTags)
          : finalTags,
      })
      onOpenChange(false)
      showToast.success(t('toast.metadataSaved'))
    } catch (error) {
      showToast.error(
        t('toast.metadataFailed'),
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('metadata.title')}</DialogTitle>
          <DialogDescription>{t('metadata.description')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            handleSave()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-meta-name">{t('metadata.nameLabel')}</Label>
            <Input
              id="run-meta-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('metadata.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-meta-desc">
              {t('metadata.descriptionLabel')}
            </Label>
            <Textarea
              id="run-meta-desc"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('metadata.descriptionPlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-meta-tags">{t('metadata.tagsLabel')}</Label>
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== tag))}
                    aria-label={`${t('metadata.tagsLabel')}: ${tag}`}
                    className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                id="run-meta-tags"
                value={tagDraft}
                onChange={(event) => handleTagChange(event.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={
                  tags.length === 0 ? t('metadata.tagsPlaceholder') : ''
                }
                className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t('metadata.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!blueprint || upsertFable.isPending}
            >
              {upsertFable.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t('metadata.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
