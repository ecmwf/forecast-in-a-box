/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Opens two GRIB outputs of one run side by side on /visualise; fills in as the sinks finish. */

import { AlertCircle, ArrowLeftRight, Columns2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type {
  ComparableOutput,
  ComparePairState,
} from '@/features/executions/outputs/compare-outputs'
import type { SourceSlot } from '@/features/viewer/geo/layer-pairing'
import {
  comparePairState,
  outputReady,
} from '@/features/executions/outputs/compare-outputs'
import { SLOT_FILL_CLASS } from '@/features/executions/components/CompareSideBadge'
import { entryRef } from '@/features/visualise/entry-ref'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'

const STATUS_KEY = {
  ready: 'storedOutputs.compare.ready',
  writing: 'storedOutputs.compare.writing',
  sharedFolder: 'storedOutputs.compare.sharedFolder',
  lost: 'storedOutputs.compare.lost',
} as const satisfies Record<ComparePairState, string>

/** Two map halves that take their slot colour as each output finishes. */
function SplitMapGlyph({ a, b }: { a: boolean; b: boolean }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-11 shrink-0 gap-px overflow-hidden rounded-md border border-border bg-border"
    >
      {(['a', 'b'] as const).map((slot) => (
        <span
          key={slot}
          className={cn(
            'flex-1 transition-colors duration-300',
            (slot === 'a' ? a : b)
              ? cn(SLOT_FILL_CLASS[slot], 'opacity-80')
              : 'bg-muted',
          )}
        />
      ))}
    </span>
  )
}

/** One side of the pair: its colour, letter and the output's name. */
function SidePill({
  slot,
  output,
  name,
}: {
  slot: SourceSlot
  output: ComparableOutput
  name: string
}) {
  const { t } = useTranslation('executions')
  return (
    <span
      aria-label={t('storedOutputs.compare.slot', {
        slot: slot.toUpperCase(),
        name,
      })}
      className="flex h-8 w-40 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-sm"
    >
      {outputReady(output) ? (
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', SLOT_FILL_CLASS[slot])}
        />
      ) : (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      )}
      <span className="font-mono font-bold">{slot.toUpperCase()}</span>
      <span className="truncate">{name}</span>
    </span>
  )
}

export function CompareOutputsBar({
  jobId,
  runName,
  a,
  b,
  labels,
  onSwap,
}: {
  jobId: string
  runName?: string
  a: ComparableOutput
  b: ComparableOutput
  /** Display name per sink block, as shown on the rows. */
  labels: Record<string, string>
  onSwap: () => void
}) {
  const { t } = useTranslation('executions')
  const state = comparePairState(a, b)
  // A blocked pair stays grey even when both outputs are written.
  const usable = state === 'ready' || state === 'writing'

  const ref = (output: ComparableOutput) =>
    entryRef({
      kind: 'output',
      jobId,
      taskId: output.taskId,
      blockId: output.blockId,
      runName: runName ?? '',
      blockTitle: output.title,
      runCreatedAt: null,
    })

  return (
    <div
      role="group"
      aria-label={t('storedOutputs.compare.title')}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3"
    >
      <SplitMapGlyph
        a={usable && outputReady(a)}
        b={usable && outputReady(b)}
      />
      <div className="min-w-0 flex-1 basis-56">
        <P className="text-sm font-medium">
          {t('storedOutputs.compare.title')}
        </P>
        {state === 'sharedFolder' ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="flex w-fit max-w-full items-center gap-1.5 text-sm text-muted-foreground" />
              }
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="truncate">{t(STATUS_KEY.sharedFolder)}</span>
            </TooltipTrigger>
            <TooltipContent>
              <P className="max-w-xs text-sm text-inherit">
                {t('storedOutputs.compare.sharedFolderHint')}
              </P>
            </TooltipContent>
          </Tooltip>
        ) : (
          <P className="truncate text-sm text-muted-foreground">
            {t(STATUS_KEY[state])}
          </P>
        )}
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        <SidePill slot="a" output={a} name={labels[a.blockId]} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onSwap}
                aria-label={t('storedOutputs.compare.swap')}
              />
            }
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t('storedOutputs.compare.swap')}</TooltipContent>
        </Tooltip>
        <SidePill slot="b" output={b} name={labels[b.blockId]} />
        {state === 'ready' ? (
          // A link, so the map can open in a new tab.
          <Button
            size="sm"
            className="ml-1.5 gap-1.5"
            nativeButton={false}
            render={<Link to="/visualise" search={{ a: ref(a), b: ref(b) }} />}
          >
            <Columns2 className="h-3.5 w-3.5" />
            {t('storedOutputs.compare.action')}
          </Button>
        ) : (
          <Button size="sm" className="ml-1.5 gap-1.5" disabled>
            {state === 'writing' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Columns2 className="h-3.5 w-3.5" />
            )}
            {t('storedOutputs.compare.action')}
          </Button>
        )}
      </div>
    </div>
  )
}
