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

import { useEffect, useState } from 'react'
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
  pairUsable,
  pickBlocker,
} from '@/features/executions/outputs/compare-outputs'
import {
  CompareSideMark,
  SLOT_FILL_CLASS,
} from '@/features/executions/components/CompareSideBadge'
import { useExecutionHoverStore } from '@/features/executions/stores/executionHoverStore'
import { entryRef } from '@/features/visualise/entry-ref'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

/** A side's readiness, letter and output name. */
function SideLabel({
  slot,
  output,
  name,
}: {
  slot: SourceSlot
  output: ComparableOutput
  name: string
}) {
  return (
    <>
      {outputReady(output) ? (
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', SLOT_FILL_CLASS[slot])}
        />
      ) : (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      )}
      <span className="font-mono font-bold">{slot.toUpperCase()}</span>
      <span className="min-w-0 truncate">{name}</span>
    </>
  )
}

interface SideProps {
  slot: SourceSlot
  output: ComparableOutput
  name: string
}

/** One side of a run with exactly two outputs. */
function SidePill({ slot, output, name }: SideProps) {
  const { t } = useTranslation('executions')
  return (
    <span
      aria-label={t('storedOutputs.compare.slot', {
        slot: slot.toUpperCase(),
        name,
      })}
      className="flex h-8 w-40 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-sm"
    >
      <SideLabel slot={slot} output={output} name={name} />
    </span>
  )
}

/** One side of a run with more outputs: picks which output is on it. */
function SidePicker({
  slot,
  output,
  name,
  other,
  outputs,
  labels,
  onPick,
  onOpenChange,
}: SideProps & {
  /** Output on the other side. */
  other: ComparableOutput
  outputs: ReadonlyArray<ComparableOutput>
  labels: Record<string, string>
  onPick: (blockId: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('executions')
  const otherSlot = slot === 'a' ? 'b' : 'a'
  return (
    <Select
      value={output.blockId}
      onValueChange={(blockId) => {
        if (typeof blockId === 'string' && blockId !== output.blockId) {
          onPick(blockId)
        }
      }}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger
        size="sm"
        aria-label={t('storedOutputs.compare.pickSide', {
          slot: slot.toUpperCase(),
        })}
        className="w-44 min-w-0 bg-background px-2 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1"
      >
        {/* Base UI would show the raw block id. */}
        <SelectValue>
          <SideLabel slot={slot} output={output} name={name} />
        </SelectValue>
      </SelectTrigger>
      {/* Below the trigger, so the side being picked stays in view. */}
      <SelectContent
        className="min-w-64"
        align="start"
        alignItemWithTrigger={false}
      >
        {outputs.map((candidate) => {
          const blocker = pickBlocker(candidate, other)
          const label = labels[candidate.blockId]
          return (
            <SelectItem
              key={candidate.blockId}
              value={candidate.blockId}
              disabled={blocker !== null}
              className="py-2 pr-2 [&_svg]:hidden"
            >
              {/* divs: the item styles its last SPAN child as a flex row. */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate">{label}</span>
                  {label !== candidate.title && (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {candidate.title}
                    </span>
                  )}
                  {candidate.blockId === output.blockId && (
                    <CompareSideMark side={slot} className="ml-auto" />
                  )}
                  {candidate.blockId === other.blockId && (
                    <CompareSideMark side={otherSlot} className="ml-auto" />
                  )}
                </div>
                {blocker && (
                  <div className="text-xs text-muted-foreground">
                    {blocker === 'lost'
                      ? t('storedOutputs.compare.pickLost')
                      : t('storedOutputs.compare.pickSharedFolder', {
                          slot: otherSlot.toUpperCase(),
                        })}
                  </div>
                )}
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export function CompareOutputsBar({
  jobId,
  runName,
  a,
  b,
  outputs,
  labels,
  onPick,
}: {
  jobId: string
  runName?: string
  a: ComparableOutput
  b: ComparableOutput
  /** Every GRIB output of the run; more than two make the sides pickers. */
  outputs: ReadonlyArray<ComparableOutput>
  /** Display name per sink block, as shown on the rows. */
  labels: Record<string, string>
  /** Put an output on a side; the other side's output swaps the two. */
  onPick: (slot: SourceSlot, blockId: string) => void
}) {
  const { t } = useTranslation('executions')
  const state = comparePairState(a, b)
  // A blocked pair stays grey even when both outputs are written.
  const usable = pairUsable(state)

  // The graph shows the sides while the row is in use.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [openPicker, setOpenPicker] = useState<SourceSlot | null>(null)
  const inUse = hovered || focused || openPicker !== null
  const setSidesShown = useExecutionHoverStore((s) => s.setCompareSidesShown)
  useEffect(() => {
    setSidesShown(inUse)
    return () => setSidesShown(false)
  }, [inUse, setSidesShown])

  const side = (slot: SourceSlot) => {
    const output = slot === 'a' ? a : b
    const name = labels[output.blockId]
    if (outputs.length <= 2) {
      return <SidePill slot={slot} output={output} name={name} />
    }
    return (
      <SidePicker
        slot={slot}
        output={output}
        name={name}
        other={slot === 'a' ? b : a}
        outputs={outputs}
        labels={labels}
        onPick={(blockId) => onPick(slot, blockId)}
        onOpenChange={(open) =>
          setOpenPicker((current) =>
            open ? slot : current === slot ? null : current,
          )
        }
      />
    )
  }

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
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Keyboard focus only: a clicked button keeps focus after the pointer left.
      onFocus={(e) => setFocused(e.target.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
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
        {side('a')}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onPick('a', b.blockId)}
                aria-label={t('storedOutputs.compare.swap')}
              />
            }
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t('storedOutputs.compare.swap')}</TooltipContent>
        </Tooltip>
        {side('b')}
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
