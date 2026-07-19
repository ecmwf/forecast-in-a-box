/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  CornerDownLeft,
  Loader2,
  Play,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type { FormEvent, RefObject } from 'react'
import type {
  FableBuilderV1,
  FableRetrieveResponse,
} from '@/api/types/fable.types'
import type { EnvironmentSpecification } from '@/api/types/job.types'
import { showToast } from '@/lib/toast'
import { createDefaultEnvironment } from '@/api/types/job.types'
import { useBlockCatalogue, useFableRetrieve } from '@/api/hooks/useFable'
import { buildDefaultJobName } from '@/features/executions/utils/job-name'
import { useSubmitFable } from '@/api/hooks/useJobs'
import { useCreateSchedule } from '@/api/hooks/useSchedules'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { ScheduleFields } from '@/features/schedules/components/ScheduleFields'
import { EnvironmentConfig } from '@/features/executions/components/EnvironmentConfig'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TagInput } from '@/components/common/TagInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActivityStore } from '@/stores/activityStore'
import { stripSystemTags } from '@/lib/system-tags'
import { cn } from '@/lib/utils'

export type SubmitMode = 'run' | 'schedule'

interface SubmitRunDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fable: FableBuilderV1
  fableId: string | null
  /** Tab to open on. Defaults to 'run'. */
  initialMode?: SubmitMode
}

export function SubmitRunDialog({
  open,
  onOpenChange,
  fable,
  fableId,
  initialMode = 'run',
}: SubmitRunDialogProps) {
  const { data: fableData } = useFableRetrieve(fableId)
  // Focus the name field on open so Enter submits; otherwise focus lands on
  // the run/schedule toggle (first tabbable) and Enter would flip the mode.
  const nameRef = useRef<HTMLInputElement>(null)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent initialFocus={nameRef}>
        {open && (
          <SubmitRunForm
            onOpenChange={onOpenChange}
            fable={fable}
            fableId={fableId}
            fableData={fableData}
            nameRef={nameRef}
            initialMode={initialMode}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface SubmitRunFormProps {
  onOpenChange: (open: boolean) => void
  fable: FableBuilderV1
  fableId: string | null
  fableData: FableRetrieveResponse | undefined
  nameRef: RefObject<HTMLInputElement | null>
  initialMode: SubmitMode
}

function SubmitRunForm({
  onOpenChange,
  fable,
  fableId,
  fableData,
  nameRef,
  initialMode,
}: SubmitRunFormProps) {
  const { t } = useTranslation('executions')
  const navigate = useNavigate()
  const submitFable = useSubmitFable()
  const createSchedule = useCreateSchedule()
  const markSubmitted = useFableBuilderStore((s) => s.markSubmitted)
  const { data: catalogue } = useBlockCatalogue()

  // Derive a sensible fallback name from the fable contents. Computed once
  // when the dialog opens (the mount freezes `now`) so the placeholder stays
  // stable while the user reads it.
  const generatedName = useMemo(
    () => buildDefaultJobName({ fable, catalogue, fableData }),
    [fable, catalogue, fableData],
  )

  const [mode, setMode] = useState<SubmitMode>(initialMode)
  const [name, setName] = useState(() => fableData?.display_name || '')
  const [description, setDescription] = useState(
    () => fableData?.display_description || '',
  )
  const [tags, setTags] = useState<Array<string>>(() =>
    stripSystemTags(fableData?.tags),
  )
  const [environment, setEnvironment] = useState<EnvironmentSpecification>(
    createDefaultEnvironment,
  )
  const [error, setError] = useState<string | null>(null)

  // Schedule-specific state
  const [cronExpr, setCronExpr] = useState('0 6 * * *')
  const [maxDelayHours, setMaxDelayHours] = useState(2)

  async function handleSubmitRun() {
    setError(null)

    // Fall back to the config-derived name when the user didn't enter one,
    // so submitted jobs are never titled "Untitled Job".
    const trimmedName = name.trim() || generatedName
    const trimmedDescription = description.trim() || null

    try {
      const response = await submitFable.mutateAsync({
        fable,
        name: trimmedName,
        description: trimmedDescription,
        tags,
        fableId,
        environment,
      })

      useActivityStore.getState().addTask({
        id: `job:${response.run_id}`,
        type: 'job',
        label:
          trimmedName ||
          t('activity.jobFallbackLabel', {
            id: response.run_id.slice(0, 8),
          }),
        description: t('activity.submitted'),
        status: 'active',
        startedAt: Date.now(),
        navigateTo: `/runs/${response.run_id}`,
      })

      showToast.success(t('submit.title'), trimmedName || undefined)

      // The fable has been committed — wipe the localStorage draft so the
      // builder doesn't resurrect it next time the user lands on /configure.
      markSubmitted()

      onOpenChange(false)
      navigate({
        to: '/runs/$jobId',
        params: { jobId: response.run_id },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCreateSchedule() {
    setError(null)

    try {
      await createSchedule.mutateAsync({
        fable,
        name: name.trim(),
        description: description.trim(),
        tags,
        fableId,
        cronExpr,
        maxAcceptableDelayHours: maxDelayHours,
      })

      showToast.success(t('submit.scheduleCreated'), name.trim())

      // Schedule created successfully — drop the draft so a return visit to
      // /configure doesn't restore an already-scheduled fable as "unsaved".
      markSubmitted()

      onOpenChange(false)
      navigate({ to: '/schedules' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const isPending =
    mode === 'run' ? submitFable.isPending : createSchedule.isPending

  // Enter anywhere in the form submits — mirroring the primary button, and
  // guarded by the same conditions (a schedule needs a name).
  function handleFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (isPending) return
    if (mode === 'run') {
      handleSubmitRun()
    } else if (name.trim()) {
      handleCreateSchedule()
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('submit.title')}</AlertDialogTitle>
      </AlertDialogHeader>

      <form className="space-y-4" onSubmit={handleFormSubmit}>
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
            ref={nameRef}
            id="submit-name"
            placeholder={
              mode === 'run' ? generatedName : t('submit.namePlaceholder')
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          <TagInput
            id="submit-tags"
            tags={tags}
            onTagsChange={setTags}
            placeholder={
              mode === 'run'
                ? t('submit.tagsPlaceholderOptional')
                : t('submit.tagsPlaceholder')
            }
          />
        </div>

        {/* Schedule-specific fields */}
        {mode === 'schedule' && (
          <ScheduleFields
            cronExpr={cronExpr}
            onCronChange={setCronExpr}
            maxDelayHours={maxDelayHours}
            onMaxDelayChange={setMaxDelayHours}
          />
        )}

        <EnvironmentConfig
          environment={environment}
          onChange={setEnvironment}
        />

        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('submit.cancel')}
          </Button>
          <Button
            type="submit"
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
            {/* ↵ marks the default action — Enter submits. */}
            {!isPending && (
              <CornerDownLeft className="size-3.5 opacity-70" aria-hidden />
            )}
          </Button>
        </AlertDialogFooter>
      </form>
    </>
  )
}
