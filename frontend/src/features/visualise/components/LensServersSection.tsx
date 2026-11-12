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
 * Running WMS (lens) servers for the system status popover: the run each
 * serves, what its capabilities advertise, its WMS URL and a Stop.
 * Renders nothing while no server runs.
 */

import { Fragment, useMemo } from 'react'
import { CircleStop } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { INDEXED_RUNS, useLensPathIndex } from '../hooks/useLensPathIndex'
import { slotCaption } from '../slot-caption'
import { CopyWmsUrlButton } from './CopyWmsUrlButton'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import type { LensPathMatch } from '../hooks/useLensPathIndex'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useFableRetrieve } from '@/api/hooks/useFable'
import { useLensList, useStopLens } from '@/api/hooks/useLens'
import {
  buildAbsoluteWmsCapabilitiesUrl,
  buildLensBaseUrl,
} from '@/api/endpoints/lens'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useLensSource } from '@/features/viewer/hooks/useLensSource'
import {
  expandTimeSteps,
  parseWmsTimestamp,
} from '@/features/viewer/wms-capabilities'
import { formatInZone, useAppTimeZone } from '@/lib/datetime'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const TIME_PATTERN = 'dd MMM HH:mm'

export function LensServersSection() {
  const { t } = useTranslation('visualise')
  const { data: lensList } = useLensList()
  const pathIndex = useLensPathIndex()
  const { data: jobs } = useJobsStatus(1, INDEXED_RUNS)
  const blueprintByJob = useMemo(
    () => new Map((jobs?.runs ?? []).map((r) => [r.run_id, r.blueprint_id])),
    [jobs],
  )

  // The registry keeps failed/terminated records: live servers only.
  const lenses = (lensList ?? []).filter(
    (l) => l.status === 'running' || l.status === 'starting',
  )
  if (lenses.length === 0) return null
  return (
    <section className="mt-2 space-y-1 border-t pt-2">
      <div className="flex items-baseline justify-between px-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('servers.title')}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('servers.count', { count: lenses.length })}
        </span>
      </div>
      <ul className="max-h-72 space-y-0.5 overflow-y-auto">
        {lenses.map((lens) => {
          const match = pathIndex.get(localPathOf(lens))
          return (
            <LensServerRow
              key={lens.lens_instance_id}
              lens={lens}
              match={match}
              blueprintId={match ? blueprintByJob.get(match.jobId) : undefined}
            />
          )
        })}
      </ul>
      <p className="px-2 text-xs text-muted-foreground">{t('wmsUrl.hint')}</p>
    </section>
  )
}

function localPathOf(lens: LensInstanceDetailResponse): string {
  const path = lens.lens_params.local_path
  return typeof path === 'string' ? path : ''
}

function LensServerRow({
  lens,
  match,
  blueprintId,
}: {
  lens: LensInstanceDetailResponse
  /** The run output served, when the folder belongs to a recent run. */
  match: LensPathMatch | undefined
  blueprintId: string | undefined
}) {
  const { t } = useTranslation('visualise')
  const timeZone = useAppTimeZone()
  const stopMutation = useStopLens()
  const { data: fable } = useFableRetrieve(blueprintId)
  const running = lens.status === 'running'
  const source = useLensSource(
    running ? buildLensBaseUrl(lens.lens_instance_id) : null,
  )

  const path = localPathOf(lens)
  const folder = path.split('/').filter(Boolean).at(-1) ?? path
  const caption = match
    ? slotCaption(
        {
          kind: 'output',
          jobId: match.jobId,
          taskId: match.taskId,
          blockId: match.blockId,
          runName: fable?.display_name?.trim() ?? '',
          blockTitle: folder,
          runCreatedAt: match.runCreatedAt,
          addedAt: 0,
        },
        timeZone,
      )
    : { label: folder, submittedAt: null }

  const range = useMemo(() => timeRange(source.layers), [source.layers])
  const meta = running
    ? [
        caption.submittedAt &&
          t('servers.submitted', { when: caption.submittedAt }),
        source.groups.length > 0 &&
          t('servers.params', { count: source.groups.length }),
        range &&
          t('servers.range', {
            from: formatInZone(range[0], timeZone, TIME_PATTERN),
            to: formatInZone(range[1], timeZone, TIME_PATTERN),
          }),
      ].filter((piece): piece is string => !!piece)
    : [t('servers.starting')]

  const stopLabel = t('servers.stop')
  return (
    <li className="flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/50">
      <span
        className={cn(
          'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
          running ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger render={<p className="truncate text-sm" />}>
            {caption.label}
          </TooltipTrigger>
          <TooltipContent className="max-w-80 flex-col items-start gap-1">
            {caption.label}
            <span className="font-mono break-all">{path}</span>
          </TooltipContent>
        </Tooltip>
        {/* Wraps only between pieces. */}
        <p className="text-xs text-muted-foreground">
          {meta.length === 0
            ? '…'
            : meta.map((piece, i) => (
                <Fragment key={piece}>
                  {i > 0 && ' · '}
                  <span className="whitespace-nowrap">{piece}</span>
                </Fragment>
              ))}
        </p>
      </div>
      <CopyWmsUrlButton
        className="h-7 w-7"
        url={
          running
            ? buildAbsoluteWmsCapabilitiesUrl(lens.lens_instance_id)
            : null
        }
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={stopMutation.isPending}
              onClick={() =>
                stopMutation.mutate(
                  { lensInstanceId: lens.lens_instance_id },
                  { onError: (err) => showToast.error(err.message) },
                )
              }
              aria-label={stopLabel}
            />
          }
        >
          <CircleStop className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>{stopLabel}</TooltipContent>
      </Tooltip>
    </li>
  )
}

/** First and last advertised valid time (epoch ms); null without time. */
export function timeRange(
  layers: ReadonlyArray<ParsedLayer>,
): [number, number] | null {
  let first = Infinity
  let last = -Infinity
  for (const layer of layers) {
    if (!layer.time) continue
    for (const step of expandTimeSteps(layer.time.raw)) {
      const ms = parseWmsTimestamp(step)
      if (Number.isNaN(ms)) continue
      first = Math.min(first, ms)
      last = Math.max(last, ms)
    }
  }
  return first <= last ? [first, last] : null
}
