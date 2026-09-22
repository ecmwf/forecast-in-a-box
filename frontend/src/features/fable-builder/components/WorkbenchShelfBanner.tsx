/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Strip above the canvas while a set-aside configuration exists:
 *  restore (dirty work swaps — lossless), export as JSON, or discard. */

import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { History, X } from 'lucide-react'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import {
  benchSnapshot,
  useWorkbenchShelfStore,
} from '@/features/fable-builder/stores/workbenchShelfStore'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { downloadFableJson } from '@/features/fable-builder/utils/export-config'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'

/** Coarse age label: minutes under an hour, hours under a day, then days. */
function useAgeLabel(savedAt: number): string {
  const { t } = useTranslation('configure')
  const minutes = Math.round((Date.now() - savedAt) / 60_000)
  if (minutes < 1) return t('shelf.justNow')
  if (minutes < 60) return t('shelf.minutesAgo', { count: minutes })
  if (minutes < 24 * 60)
    return t('shelf.hoursAgo', { count: Math.round(minutes / 60) })
  return t('shelf.daysAgo', { count: Math.round(minutes / (24 * 60)) })
}

export function WorkbenchShelfBanner() {
  const shelf = useWorkbenchShelfStore((state) => state.shelf)
  if (!shelf) return null
  return <ShelfRow key={shelf.savedAt} />
}

function ShelfRow() {
  const { t } = useTranslation('configure')
  const navigate = useNavigate()
  // Non-null: the parent renders this row only while a shelf exists.
  const shelf = useWorkbenchShelfStore((state) => state.shelf)!
  const ageLabel = useAgeLabel(shelf.savedAt)

  const name = shelf.fableName || t('shelf.untitled')
  const blockCount = Object.keys(shelf.fable.blocks).length

  const restore = () => {
    const store = useWorkbenchShelfStore.getState()
    const current = useFableBuilderStore.getState()
    // Dirty bench work swaps onto the shelf; a clean bench just yields.
    if (Object.keys(current.fable.blocks).length > 0 && current.isDirty) {
      store.shelve(benchSnapshot())
      showToast.info(t('shelf.swapped'))
    } else {
      store.clear()
    }
    useFableBuilderStore.getState().setFable(shelf.fable, shelf.fableId)
    useFableBuilderStore.setState({
      fableName: shelf.fableName,
      fableVersion: shelf.fableVersion,
      forkParentId: shelf.forkParentId,
      isDirty: true,
    })
    // Strip any payload params so a reload doesn't re-run the arrival.
    void navigate({ to: '/configure', replace: true })
  }

  const exportJson = () => {
    try {
      downloadFableJson(shelf.fable, name)
    } catch (error) {
      showToast.error(
        t('header.exportFailed'),
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return (
    <div
      data-testid="workbench-shelf-banner"
      className="flex shrink-0 items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
        <History className="size-4.5" />
      </span>
      <div className="min-w-0 shrink-0">
        <p className="text-sm font-semibold">{t('shelf.title')}</p>
        <p className="truncate text-xs text-muted-foreground">
          {name} · {t('shelf.blockCount', { count: blockCount })} · {ageLabel}
        </p>
      </div>
      <FableMiniFlow
        builder={shelf.fable}
        monochrome={false}
        className="mx-auto hidden max-h-12 min-w-0 lg:block"
      />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={restore}>
          {t('shelf.restore')}
        </Button>
        <Button size="sm" variant="outline" onClick={exportJson}>
          {t('shelf.export')}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={t('shelf.discard')}
          onClick={() => useWorkbenchShelfStore.getState().clear()}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
