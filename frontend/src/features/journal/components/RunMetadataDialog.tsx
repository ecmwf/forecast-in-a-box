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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FableRetrieveResponse } from '@/api/types/fable.types'
import { useUpsertFable } from '@/api/hooks/useFable'
import {
  isOneoffBlueprint,
  stripSystemTags,
  withOneoffTag,
} from '@/lib/system-tags'
import { showToast } from '@/lib/toast'
import { TagInput } from '@/components/common/TagInput'
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

  // Seed the form from the blueprint each time the dialog opens.
  useEffect(() => {
    if (open && blueprint) {
      setName(blueprint.display_name ?? '')
      setDescription(blueprint.display_description ?? '')
      setTags(stripSystemTags(blueprint.tags))
    }
  }, [open, blueprint])

  async function handleSave() {
    if (!blueprint) return
    try {
      await upsertFable.mutateAsync({
        fable: blueprint.builder,
        fableId: blueprint.blueprint_id,
        fableVersion: blueprint.version,
        display_name: name.trim() || (blueprint.display_name ?? ''),
        display_description: description.trim(),
        // Keep the one-off marker — editing details must not promote a run
        // to a preset (that is the explicit "Save as preset" action).
        tags: isOneoffBlueprint(blueprint.tags) ? withOneoffTag(tags) : tags,
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
            <TagInput
              id="run-meta-tags"
              tags={tags}
              onTagsChange={setTags}
              placeholder={t('metadata.tagsPlaceholder')}
            />
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
