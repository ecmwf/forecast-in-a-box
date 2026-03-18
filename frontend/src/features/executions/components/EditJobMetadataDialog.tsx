/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { JobMetadata } from '@/features/executions/stores/useJobMetadataStore'
import { useJobMetadataStore } from '@/features/executions/stores/useJobMetadataStore'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EditJobMetadataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  metadata: JobMetadata
}

export function EditJobMetadataDialog({
  open,
  onOpenChange,
  jobId,
  metadata,
}: EditJobMetadataDialogProps) {
  const { t } = useTranslation('executions')
  const updateJob = useJobMetadataStore((s) => s.updateJob)

  const [name, setName] = useState(metadata.name)
  const [description, setDescription] = useState(metadata.description)
  const [tags, setTags] = useState<Array<string>>(metadata.tags)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (open) {
      setName(metadata.name)
      setDescription(metadata.description)
      setTags([...metadata.tags])
      setTagInput('')
    }
  }, [open, metadata.name, metadata.description, metadata.tags])

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = tagInput.trim()
      if (trimmed && !tags.includes(trimmed)) {
        setTags([...tags, trimmed])
      }
      setTagInput('')
    }
  }

  function handleRemoveTag(tag: string) {
    setTags(tags.filter((existing) => existing !== tag))
  }

  function handleSave() {
    const finalTags = [...tags]
    const pendingTag = tagInput.trim()
    if (pendingTag && !finalTags.includes(pendingTag)) {
      finalTags.push(pendingTag)
    }
    updateJob(jobId, {
      name: name.trim(),
      description: description.trim(),
      tags: finalTags,
    })
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('actions.editDetails')}</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">{t('submit.name')}</Label>
            <Input
              id="edit-name"
              placeholder={t('submit.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-description">{t('submit.description')}</Label>
            <textarea
              id="edit-description"
              rows={2}
              placeholder={t('submit.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tags">{t('submit.tags')}</Label>
            <Input
              id="edit-tags"
              placeholder={t('submit.tagsPlaceholder')}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
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
              </div>
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('submit.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {t('actions.save')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
