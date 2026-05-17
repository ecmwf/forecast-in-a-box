/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The run row's ⋯ menu — edit config, preset toggle, delete (with confirm). */

import { useState } from 'react'
import {
  BookmarkMinus,
  BookmarkPlus,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type { FableRetrieveResponse } from '@/api/types/fable.types'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { useUpsertFable } from '@/api/hooks/useFable'
import { useDeleteJob } from '@/api/hooks/useJobs'
import {
  isOneoffBlueprint,
  withOneoffTag,
  withoutOneoffTag,
} from '@/lib/system-tags'
import { showToast } from '@/lib/toast'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface RunRowMenuProps {
  run: ForecastRunViewModel
  /** The run's blueprint — undefined until it loads. */
  blueprint: FableRetrieveResponse | undefined
}

export function RunRowMenu({ run, blueprint }: RunRowMenuProps) {
  const { t } = useTranslation('journal')
  const navigate = useNavigate()
  const upsertFable = useUpsertFable()
  const deleteJob = useDeleteJob()
  const [deleteOpen, setDeleteOpen] = useState(false)

  // No one-off marker means the blueprint is already a saved preset.
  const isPreset = blueprint != null && !isOneoffBlueprint(blueprint.tags)

  async function handleTogglePreset() {
    if (!blueprint) return
    try {
      await upsertFable.mutateAsync({
        fable: blueprint.builder,
        fableId: blueprint.blueprint_id,
        fableVersion: blueprint.version,
        display_name: blueprint.display_name ?? '',
        display_description: blueprint.display_description ?? '',
        tags: isPreset
          ? withOneoffTag(blueprint.tags)
          : withoutOneoffTag(blueprint.tags),
      })
      showToast.success(
        isPreset ? t('toast.removedFromPreset') : t('toast.savedAsPreset'),
      )
    } catch (error) {
      showToast.error(
        t('toast.presetFailed'),
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async function handleDelete() {
    try {
      await deleteJob.mutateAsync({
        runId: run.runId,
        attemptCount: run.attemptCount,
      })
      setDeleteOpen(false)
      showToast.success(t('toast.runDeleted'))
    } catch (error) {
      showToast.error(
        t('toast.deleteFailed'),
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="transition-colors hover:text-primary"
              aria-label={t('item.moreOptions')}
            />
          }
        >
          <MoreVertical className="h-5 w-5" />
        </DropdownMenuTrigger>
        {/* w-fit: size to content — the default matches the tiny trigger. */}
        <DropdownMenuContent align="end" className="w-fit">
          <DropdownMenuItem
            onClick={() =>
              navigate({
                to: '/configure',
                search: { fableId: run.blueprintId },
              })
            }
          >
            <Pencil className="h-4 w-4" />
            {t('item.editConfig')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleTogglePreset}
            disabled={!blueprint || upsertFable.isPending}
          >
            {isPreset ? (
              <BookmarkMinus className="h-4 w-4" />
            ) : (
              <BookmarkPlus className="h-4 w-4" />
            )}
            {isPreset ? t('item.removeFromPreset') : t('item.saveAsPreset')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            {t('item.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteRun.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteRun.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              {t('deleteRun.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteJob.isPending}
            >
              {t('deleteRun.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
