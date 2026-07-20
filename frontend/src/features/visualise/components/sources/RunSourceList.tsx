/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Runs with stored (GRIB-dir) outputs, each with an add-to-basket action.
 * `paged` grows the scanned run window in place ("Load more") — the
 * backend cannot filter for stored outputs yet, so scanning is client-side.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { entryDisplayName } from '../../entry-ref'
import { gribMarkerRows } from '../../hooks/useLensPathIndex'
import { AddToComparisonButton } from '../AddToComparisonButton'
import type { GribMarkerRow } from '../../hooks/useLensPathIndex'
import type { NewComparisonEntry } from '../../entry-ref'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { formatInZone, useAppTimeZone } from '@/lib/datetime'

export const RUN_SCAN_WINDOW = 20

export function RunSourceList({
  query,
  paged = false,
}: {
  /** Lower-cased filter over name / block / job id. */
  query: string
  paged?: boolean
}) {
  const { t } = useTranslation('visualise')
  const [scan, setScan] = useState(RUN_SCAN_WINDOW)
  const { data: jobsList } = useJobsStatus(1, paged ? scan : RUN_SCAN_WINDOW)

  const markerRows = useMemo(
    () => gribMarkerRows(jobsList?.runs ?? []),
    [jobsList],
  )
  const blueprintByJob = useMemo(
    () =>
      new Map(
        (jobsList?.runs ?? []).map((r) => [r.run_id, r.blueprint_id]),
      ),
    [jobsList],
  )
  const hasMore = paged && (jobsList?.total ?? 0) > scan

  if (markerRows.length === 0) {
    return (
      <P className="py-2 text-sm text-muted-foreground">{t('picker.empty')}</P>
    )
  }
  return (
    <>
      <ul className="divide-y divide-border">
        {markerRows.map((row) => (
          <RunSourceRow
            key={`${row.jobId}:${row.blockId}`}
            row={row}
            filter={query}
            blueprintId={blueprintByJob.get(row.jobId)}
          />
        ))}
      </ul>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs text-muted-foreground"
          onClick={() => setScan((n) => n + RUN_SCAN_WINDOW)}
        >
          {t('picker.loadMore')}
        </Button>
      )}
    </>
  )
}

/** One run-output row: blueprint name resolved lazily per row. */
function RunSourceRow({
  row,
  filter,
  blueprintId,
}: {
  row: GribMarkerRow
  filter: string
  blueprintId: string | undefined
}) {
  const timeZone = useAppTimeZone()
  const { data: fableData } = useFableRetrieve(blueprintId)
  const runName = fableData?.display_name?.trim() ?? ''

  const entry: NewComparisonEntry = {
    kind: 'output',
    jobId: row.jobId,
    taskId: row.taskId,
    blockId: row.blockId,
    runName,
    blockTitle: row.blockId,
    runCreatedAt: row.runCreatedAt,
  }
  const name = entryDisplayName(entry)
  const haystack = `${name} ${row.blockId} ${row.jobId}`.toLowerCase()
  if (filter && !haystack.includes(filter)) return null

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        {/* Re-runs share the blueprint name — the date chip never truncates. */}
        <div className="flex items-baseline gap-2">
          <P className="min-w-0 truncate text-sm font-medium" title={name}>
            {name}
          </P>
          {row.runCreatedAt && (
            <span className="shrink-0 rounded bg-muted px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              {formatInZone(new Date(row.runCreatedAt), timeZone, 'dd MMM HH:mm')}
            </span>
          )}
        </div>
        <P className="truncate font-mono text-[11px] text-muted-foreground/70">
          {row.jobId.slice(0, 8)} · {row.blockId}
        </P>
      </div>
      <AddToComparisonButton entry={entry} />
    </li>
  )
}
