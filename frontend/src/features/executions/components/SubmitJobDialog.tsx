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
import { AlertCircle, Calendar, Loader2, Play, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type {
  FableBuilderV1,
  FableRetrieveResponse,
} from '@/api/types/fable.types'
import type { EnvironmentSpecification } from '@/api/types/job.types'
import { createDefaultEnvironment } from '@/api/types/job.types'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { useSubmitFable } from '@/api/hooks/useJobs'
import { useCreateSchedule } from '@/api/hooks/useSchedules'
import { CronExpressionInput } from '@/features/schedules/components/CronExpressionInput'
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
import { cn } from '@/lib/utils'

type SubmitMode = 'run' | 'schedule'

interface SubmitJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fable: FableBuilderV1
  fableName: string
  fableId: string | null
}

export function SubmitJobDialog({
  open,
  onOpenChange,
  fable,
  fableId,
}: SubmitJobDialogProps) {
  const { data: fableData } = useFableRetrieve(fableId)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {open && (
          <SubmitJobForm
            onOpenChange={onOpenChange}
            fable={fable}
            fableId={fableId}
            fableData={fableData}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface SubmitJobFormProps {
  onOpenChange: (open: boolean) => void
  fable: FableBuilderV1
  fableId: string | null
  fableData: FableRetrieveResponse | undefined
}

function SubmitJobForm({
  onOpenChange,
  fable,
  fableId,
  fableData,
}: SubmitJobFormProps) {
  const { t } = useTranslation('executions')
  const navigate = useNavigate()
  const submitFable = useSubmitFable()
  const createSchedule = useCreateSchedule()

  const [mode, setMode] = useState<SubmitMode>('run')
  const [name, setName] = useState(() => fableData?.display_name || '')
  const [description, setDescription] = useState(
    () => fableData?.display_description || '',
  )
  const [tags, setTags] = useState<Array<string>>(() =>
    fableData?.tags ? [...fableData.tags] : [],
  )
  const [tagInput, setTagInput] = useState('')
  const [environment, setEnvironment] = useState<EnvironmentSpecification>(
    createDefaultEnvironment,
  )
  const [error, setError] = useState<string | null>(null)

  // Schedule-specific state
  const [cronExpr, setCronExpr] = useState('0 6 * * *')
  const [maxDelayHours, setMaxDelayHours] = useState(2)
  const [dynamicExpr] = useState<Record<string, unknown>>({})

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
      // All parts except the last become tags; the last stays in input
      for (const part of parts.slice(0, -1)) {
        addTag(part)
      }
      setTagInput(parts[parts.length - 1])
    } else {
      setTagInput(value)
    }
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
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

  async function handleSubmitRun() {
    setError(null)

    const finalTags = [...tags]
    const pendingTag = tagInput.trim()
    if (pendingTag && !finalTags.includes(pendingTag)) {
      finalTags.push(pendingTag)
    }

    // Send null for empty name/description so backend marks source as "oneoff_execution"
    const trimmedName = name.trim() || null
    const trimmedDescription = description.trim() || null

    try {
      const response = await submitFable.mutateAsync({
        fable,
        name: trimmedName,
        description: trimmedDescription,
        tags: finalTags,
        fableId,
        environment,
      })

      toast.success(t('submit.title'), {
        description: trimmedName ?? undefined,
      })

      onOpenChange(false)
      navigate({
        to: '/executions/$jobId',
        params: { jobId: response.run_id },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCreateSchedule() {
    setError(null)

    const finalTags = [...tags]
    const pendingTag = tagInput.trim()
    if (pendingTag && !finalTags.includes(pendingTag)) {
      finalTags.push(pendingTag)
    }

    try {
      await createSchedule.mutateAsync({
        fable,
        name: name.trim(),
        description: description.trim(),
        tags: finalTags,
        fableId,
        cronExpr,
        maxAcceptableDelayHours: maxDelayHours,
        dynamicExpr,
      })

      toast.success(t('submit.scheduleCreated'), {
        description: name.trim(),
      })

      onOpenChange(false)
      navigate({ to: '/schedules' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isPending =
    mode === 'run' ? submitFable.isPending : createSchedule.isPending

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('submit.title')}</AlertDialogTitle>
      </AlertDialogHeader>

      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => setMode('run')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === 'run'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Play className="h-4 w-4" />
            {t('submit.modeRunNow')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('schedule')
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === 'schedule'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Calendar className="h-4 w-4" />
            {t('submit.modeSchedule')}
          </button>
        </div>

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
            placeholder={
              mode === 'run'
                ? t('submit.namePlaceholderOptional')
                : t('submit.namePlaceholder')
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submit-description">{t('submit.description')}</Label>
          <textarea
            id="submit-description"
            rows={2}
            placeholder={
              mode === 'run'
                ? t('submit.descriptionPlaceholderOptional')
                : t('submit.descriptionPlaceholder')
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submit-tags">{t('submit.tags')}</Label>
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
              id="submit-tags"
              placeholder={
                tags.length === 0
                  ? mode === 'run'
                    ? t('submit.tagsPlaceholderOptional')
                    : t('submit.tagsPlaceholder')
                  : ''
              }
              value={tagInput}
              onChange={handleTagChange}
              onKeyDown={handleTagKeyDown}
              className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Schedule-specific fields */}
        {mode === 'schedule' && (
          <>
            <CronExpressionInput value={cronExpr} onChange={setCronExpr} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="submit-max-delay">{t('submit.maxDelay')}</Label>
              <Input
                id="submit-max-delay"
                type="number"
                min={0}
                value={maxDelayHours}
                onChange={(e) => setMaxDelayHours(Number(e.target.value))}
                className="w-32"
              />
              <p className="text-sm text-muted-foreground">
                {t('submit.maxDelayHelp')}
              </p>
            </div>
          </>
        )}

        <EnvironmentConfig
          environment={environment}
          onChange={setEnvironment}
        />
      </div>

      <AlertDialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          {t('submit.cancel')}
        </Button>
        <Button
          onClick={mode === 'run' ? handleSubmitRun : handleCreateSchedule}
          disabled={isPending || (mode === 'schedule' && !name.trim())}
        >
          {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {mode === 'run'
            ? isPending
              ? t('submit.submitting')
              : t('submit.submit')
            : isPending
              ? t('submit.creatingSchedule')
              : t('submit.createSchedule')}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
