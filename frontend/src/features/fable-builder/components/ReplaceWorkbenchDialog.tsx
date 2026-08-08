/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Dim the rival on hover only — auto-focus + hover can coexist and would gray out both cards.
const DIM_WHEN_INCOMING_ACTIVE =
  'transition-all duration-200 group-has-[[data-choice=incoming]:hover]:opacity-40 group-has-[[data-choice=incoming]:hover]:grayscale'
const DIM_WHEN_BENCH_ACTIVE =
  'transition-all duration-200 group-has-[[data-choice=bench]:hover]:opacity-40 group-has-[[data-choice=bench]:hover]:grayscale'
const CARD_ACTIVE =
  'outline-none hover:border-primary hover:bg-primary/5 hover:shadow-md focus-visible:border-primary focus-visible:bg-primary/5'

export interface WorkbenchReplaceTarget {
  fable: FableBuilderV1
  fableName: string
  /** Unsaved changes get the loss warning; a saved bench a softer one. */
  unsaved: boolean
}

/** What would land on the bench if the selection wins. */
export interface WorkbenchIncoming {
  /** Display name when known. */
  label: string | null
  /** Builder for the preview when known; null while loading or for a blank. */
  fable: FableBuilderV1 | null
  /** Explicit new/blank canvas intent. */
  isNew: boolean
}

/** The workbench model's one interruption: clicking a card puts it on the canvas. */
export function ReplaceWorkbenchDialog({
  target,
  incoming,
  onCancel,
  onReplace,
}: {
  target: WorkbenchReplaceTarget | null
  incoming: WorkbenchIncoming
  onCancel: () => void
  onReplace: () => void
}) {
  const { t } = useTranslation('configure')
  const blockCount = target ? Object.keys(target.fable.blocks).length : 0
  const unsaved = target?.unsaved ?? true
  const benchLabel = t(
    unsaved ? 'replaceDialog.benchLabel' : 'replaceDialog.benchLabelSaved',
  )
  const incomingName =
    incoming.label ??
    (incoming.isNew
      ? t('replaceDialog.newConfiguration')
      : t('replaceDialog.unknownIncoming'))

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent className="sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('replaceDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              unsaved
                ? 'replaceDialog.subtitle'
                : 'replaceDialog.subtitleSaved',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="group grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            data-choice="bench"
            aria-label={benchLabel}
            onClick={onCancel}
            className={`flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left ${CARD_ACTIVE} ${DIM_WHEN_INCOMING_ACTIVE}`}
          >
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {benchLabel}
            </span>
            <span className="font-semibold">
              {target?.fableName || t('page.untitledConfiguration')}
              <span className="font-normal text-muted-foreground">
                {' · '}
                {t('replaceDialog.blockCount', { count: blockCount })}
              </span>
            </span>
            {target && (
              <FableMiniFlow
                builder={target.fable}
                monochrome={false}
                className="max-h-20"
              />
            )}
            <span className="mt-auto pt-1 text-sm text-muted-foreground">
              {t('replaceDialog.keepHint')}
            </span>
          </button>

          <button
            type="button"
            data-choice="incoming"
            aria-label={t('replaceDialog.incomingLabel')}
            onClick={onReplace}
            className={`flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left ${CARD_ACTIVE} ${DIM_WHEN_BENCH_ACTIVE}`}
          >
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('replaceDialog.incomingLabel')}
            </span>
            <span className="font-semibold">{incomingName}</span>
            {incoming.fable ? (
              <FableMiniFlow
                builder={incoming.fable}
                monochrome={false}
                className="max-h-20"
              />
            ) : incoming.isNew ? (
              <span className="flex h-14 w-full items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
                {t('replaceDialog.blankCanvas')}
              </span>
            ) : null}
            {unsaved ? (
              <span className="mt-auto flex items-center gap-1 pt-1 text-sm text-danger">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('replaceDialog.discardHint')}
              </span>
            ) : (
              <span className="mt-auto pt-1 text-sm text-muted-foreground">
                {t('replaceDialog.discardHintSaved')}
              </span>
            )}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
