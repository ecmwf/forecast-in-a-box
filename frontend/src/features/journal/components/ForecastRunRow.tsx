/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One run row in the Forecast Journal — shared by the dashboard and /executions. */

import { memo, useState } from 'react'
import { Bookmark, CalendarClock, Pencil, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ForecastRunViewModel } from '@/features/journal/types'
import type { FacetToken } from '@/features/journal/facets/facet-types'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { useServerTime } from '@/api/hooks/useSchedules'
import { RunStatusIcon } from '@/features/executions/components/RunStatusIcon'
import { getStatusBarColor } from '@/features/executions/utils/job-status'
import { AttemptHistory } from '@/features/journal/components/AttemptHistory'
import { FableMiniFlow } from '@/features/journal/components/FableMiniFlow'
import { JournalChip } from '@/features/journal/components/JournalChip'
import { RunMetadataDialog } from '@/features/journal/components/RunMetadataDialog'
import { RunRowMenu } from '@/features/journal/components/RunRowMenu'
import { formatInZone, timeZoneOffsetLabel } from '@/lib/datetime'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

interface ForecastRunRowProps {
  run: ForecastRunViewModel
  onToggleBookmark: (runId: string) => void
  /** Clicking a model/output/tag chip adds it to the journal search. */
  onAddFacet?: (token: FacetToken) => void
}

/**
 * Memoised so a keystroke in the journal search (which rebuilds the filtered
 * list) only re-renders rows whose `run`/callbacks actually changed.
 */
export const ForecastRunRow = memo(function ({
  run,
  onToggleBookmark,
  onAddFacet,
}: ForecastRunRowProps) {
  const { t } = useTranslation('journal')
  const { serverTimeToLocal, timeZone } = useServerTime()
  const showFlow = useUiStore((state) => state.journalShowFlow)
  // Cache-shared with useForecastRuns — a hit, not a new request.
  const { data: blueprint } = useFableRetrieve(run.blueprintId)
  const [metadataOpen, setMetadataOpen] = useState(false)

  const title = run.displayName || t('item.untitled')
  // created_at is UTC with explicit offset — convert via the measured server-clock offset.
  const startedInstant = serverTimeToLocal(run.createdAt)
  const startedAt =
    formatInZone(startedInstant, timeZone, 'yyyy-MM-dd HH:mm') +
    ` ${timeZoneOffsetLabel(timeZone, startedInstant)}`
  const startedDate = formatInZone(startedInstant, timeZone, 'yyyy-MM-dd')
  const runIdLabel =
    run.runId.length > 12 ? `${run.runId.slice(0, 12)}...` : run.runId
  const modelLabel = run.modelLabel

  return (
    <div className="group/row p-6 transition-colors hover:bg-muted/50">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Status */}
        <div className="mt-1 shrink-0 sm:mt-0">
          <RunStatusIcon status={run.status} />
        </div>

        {/* Details */}
        <div className="min-w-0 grow">
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            <Link
              to="/executions/$jobId"
              params={{ jobId: run.runId }}
              className="min-w-0 truncate text-sm font-medium hover:underline"
            >
              {title}
            </Link>
            {/* Reveal on row hover; always shown where hover is unavailable. */}
            <button
              type="button"
              onClick={() => setMetadataOpen(true)}
              aria-label={t('item.editMetadata')}
              className="shrink-0 text-muted-foreground opacity-0 transition-[color,opacity] group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-primary [@media(hover:none)]:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          {run.displayDescription && (
            <p className="mb-1 truncate text-sm text-muted-foreground">
              {run.displayDescription}
            </p>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{t('item.startedLabel')}</span>
            {onAddFacet ? (
              <button
                type="button"
                onClick={() => onAddFacet({ key: 'date', value: startedDate })}
                aria-label={t('item.filterByDate')}
                className="rounded transition-colors hover:text-foreground"
              >
                {startedAt}
              </button>
            ) : (
              <span>{startedAt}</span>
            )}
            <span aria-hidden>·</span>
            <span>{t('item.outputs', { count: run.outputCount })}</span>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {run.scheduleName && (
              <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-2 py-0.5 text-sm font-medium text-indigo-600 dark:text-indigo-400">
                <CalendarClock className="h-3 w-3" />
                {t('item.scheduled')}
              </span>
            )}
            {run.fromPreset && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary">
                <Bookmark className="h-3 w-3" />
                {t('item.preset')}
              </span>
            )}
            <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
              #{runIdLabel}
            </span>
            {/* Derived (system) facets, then user tags. */}
            {modelLabel && (
              <JournalChip
                label={modelLabel}
                variant="facet"
                onClick={
                  onAddFacet &&
                  (() => onAddFacet({ key: 'model', value: modelLabel }))
                }
              />
            )}
            {run.outputKinds.map((kind) => (
              <JournalChip
                key={kind}
                label={kind}
                variant="facet"
                onClick={
                  onAddFacet &&
                  (() => onAddFacet({ key: 'output', value: kind }))
                }
              />
            ))}
            {run.tags.map((tag) => (
              <JournalChip
                key={tag}
                label={tag}
                variant="tag"
                onClick={
                  onAddFacet && (() => onAddFacet({ key: 'tag', value: tag }))
                }
              />
            ))}
          </div>
        </div>

        {/* Flow preview — vertically aligned with the row actions. */}
        {showFlow && blueprint && (
          <FableMiniFlow
            builder={blueprint.builder}
            className="max-w-[18rem] shrink-0"
            monochrome
          />
        )}

        {/* Actions */}
        <div className="mt-2 flex w-full items-center justify-between gap-6 sm:mt-0 sm:w-auto sm:justify-end">
          <RunAction run={run} />

          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              type="button"
              onClick={() => onToggleBookmark(run.runId)}
              className={cn(
                'transition-colors hover:text-yellow-500',
                run.isBookmarked && 'text-yellow-500',
              )}
              aria-label={
                run.isBookmarked ? t('item.removeBookmark') : t('item.bookmark')
              }
            >
              <Star
                className={cn('h-5 w-5', run.isBookmarked && 'fill-yellow-500')}
              />
            </button>
            <RunRowMenu run={run} blueprint={blueprint} />
          </div>
        </div>
      </div>

      {run.attemptCount > 1 && (
        <div className="mt-3 sm:pl-9">
          <AttemptHistory runId={run.runId} attemptCount={run.attemptCount} />
        </div>
      )}

      <RunMetadataDialog
        blueprint={blueprint}
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
      />
    </div>
  )
})

/** Progress bar while running, otherwise a status link. */
function RunAction({ run }: { run: ForecastRunViewModel }) {
  const { t } = useTranslation('journal')

  if (run.status === 'running') {
    return (
      <div className="flex w-32 items-center gap-3">
        <span className="w-8 text-sm font-bold">
          {Math.round(run.progress)}%
        </span>
        <div className="h-2 grow overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              getStatusBarColor(run.status),
            )}
            style={{ width: `${run.progress}%` }}
          />
        </div>
      </div>
    )
  }

  const variant =
    run.status === 'completed'
      ? {
          label: t('item.viewResults'),
          className: 'text-emerald-600 dark:text-emerald-400',
        }
      : run.status === 'failed'
        ? {
            label: t('item.viewError'),
            className: 'text-red-600 dark:text-red-400',
          }
        : { label: t('item.inspect'), className: 'text-muted-foreground' }

  return (
    <Link
      to="/executions/$jobId"
      params={{ jobId: run.runId }}
      className={cn('text-sm font-semibold hover:underline', variant.className)}
    >
      {variant.label}
    </Link>
  )
}
