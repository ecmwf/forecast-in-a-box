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
import { AlertCircle, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type { EnvironmentSpecification } from '@/api/types/job.types'
import { createDefaultEnvironment } from '@/api/types/job.types'
import { useSubmitFable } from '@/api/hooks/useJobs'
import { EnvironmentConfig } from '@/features/executions/components/EnvironmentConfig'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SubmitJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fable: FableBuilderV1
  fableName: string
  fableId: string | null
}

function generateDefaultJobName(): string {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().slice(0, 5)
  return `Forecast Job ${date} ${time}`
}

export function SubmitJobDialog({
  open,
  onOpenChange,
  fable,
  fableName,
  fableId,
}: SubmitJobDialogProps) {
  const { t } = useTranslation('executions')
  const navigate = useNavigate()
  const submitFable = useSubmitFable()

  const [name, setName] = useState(generateDefaultJobName)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<Array<string>>([])
  const [tagInput, setTagInput] = useState('')
  const [environment, setEnvironment] = useState<EnvironmentSpecification>(
    createDefaultEnvironment,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(generateDefaultJobName())
      setDescription('')
      setTags([])
      setTagInput('')
      setError(null)
      setEnvironment(createDefaultEnvironment)
    }
  }, [open])

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

  async function handleSubmit() {
    setError(null)

    const finalTags = [...tags]
    const pendingTag = tagInput.trim()
    if (pendingTag && !finalTags.includes(pendingTag)) {
      finalTags.push(pendingTag)
    }

    try {
      const response = await submitFable.mutateAsync({
        fable,
        name: name.trim(),
        description: description.trim(),
        tags: finalTags,
        fableId,
        fableName,
        environment,
      })

      toast.success(t('submit.title'), {
        description: name.trim(),
      })

      onOpenChange(false)
      navigate({ to: '/executions/$jobId', params: { jobId: response.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('submit.title')}</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('errors.executionFailed')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="submit-name">{t('submit.name')}</Label>
            <Input
              id="submit-name"
              placeholder={t('submit.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="submit-description">
              {t('submit.description')}
            </Label>
            <textarea
              id="submit-description"
              rows={2}
              placeholder={t('submit.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="submit-tags">{t('submit.tags')}</Label>
            <Input
              id="submit-tags"
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

          <EnvironmentConfig
            environment={environment}
            onChange={setEnvironment}
          />
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitFable.isPending}
          >
            {t('submit.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitFable.isPending || !name.trim()}
          >
            {submitFable.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            {submitFable.isPending
              ? t('submit.submitting')
              : t('submit.submit')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
