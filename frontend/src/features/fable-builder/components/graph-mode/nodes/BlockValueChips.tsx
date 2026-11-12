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
 * A block card's set values in the block colour, choices first, each naming
 * its setting (and whether it is the default) on hover. Shows every value that
 * fits in two rows; the rest are listed behind "+N more". New values or a new
 * width lay out every chip once, measured and trimmed before paint.
 */

import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { ValueLabel } from '@/features/fable-builder/hooks/useConfigValueLabels'
import type { BlockValueEntry } from '@/features/fable-builder/utils/block-values'
import { ValueLabelDetails } from '@/features/fable-builder/components/shared/ValueLabelHint'
import { parseGlyphSegments } from '@/features/fable-builder/utils/glyph-display'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Characters a chip shows before it truncates. */
const CHIP_CHARS = 15
/** Chip rows a card shows before "+N more". */
const CHIP_ROWS = 2

const CHIP_CLASS = 'rounded-md border px-2 py-0.5 text-xs font-semibold'
const MORE_CLASS =
  'rounded-md border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'

function chipText(entry: BlockValueEntry, label: ValueLabel | undefined) {
  const text = label?.compact ?? entry.value
  return text.length > CHIP_CHARS ? `${text.slice(0, CHIP_CHARS)}...` : text
}

/** Glyph references (`${...}`) highlighted inside a chip. */
function ChipContent({ text }: { text: string }): ReactNode {
  const segments = parseGlyphSegments(text)
  if (!segments.some((s) => s.isGlyph)) return text
  return segments.map((seg, i) =>
    seg.isGlyph ? (
      <span
        key={i}
        className="rounded-md bg-primary/15 px-0.5 font-mono text-primary"
      >
        {seg.text}
      </span>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  )
}

/**
 * How many leading chips fit in CHIP_ROWS rows with the "+N more" chip.
 * `layout` holds every chip, then a sample "+N more" chip of the widest count.
 */
export function chipsThatFit(layout: HTMLElement, count: number): number {
  const chips = Array.from(layout.children) as Array<HTMLElement>
  const more = chips[count] as HTMLElement | undefined
  const tops = [...new Set(chips.slice(0, count).map((c) => c.offsetTop))]
  if (tops.length <= CHIP_ROWS || !more) return count
  const lastRowTop = tops.sort((a, b) => a - b)[CHIP_ROWS - 1]
  const gap = parseFloat(getComputedStyle(layout).columnGap) || 0
  let fit = chips
    .slice(0, count)
    .filter((c) => c.offsetTop <= lastRowTop).length
  // Drop chips from the last row until "+N more" fits after them.
  while (fit > 0) {
    const last = chips[fit - 1]
    const end =
      last.offsetTop < lastRowTop ? 0 : last.offsetLeft + last.offsetWidth + gap
    if (end + more.offsetWidth <= layout.clientWidth) break
    fit--
  }
  return fit
}

export function BlockValueChips({
  entries,
  labels,
  choiceClassName,
}: {
  /** Set values in display order: choices first. */
  entries: ReadonlyArray<BlockValueEntry>
  /** Readable labels for param/artifact values, by setting key. */
  labels: Partial<Record<string, ValueLabel>>
  /** The block kind's colours. */
  choiceClassName: string
}) {
  const { t } = useTranslation('configure')
  const rowRef = useRef<HTMLDivElement>(null)
  const signature = entries
    .map((e) => `${e.key}=${chipText(e, labels[e.key])}`)
    .join('\n')
  // null: the measuring pass, every chip plus a sample "+N more".
  const [fit, setFit] = useState<number | null>(null)
  const [measured, setMeasured] = useState(signature)
  if (measured !== signature) {
    setMeasured(signature)
    setFit(null)
  }

  useLayoutEffect(() => {
    const row = rowRef.current
    if (row && fit === null) setFit(chipsThatFit(row, entries.length))
  }, [fit, entries.length])

  // A new width or late fonts re-measure; trimming only changes the height.
  const hasRow = entries.length > 0
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    let width = row.clientWidth
    const observer = new ResizeObserver(() => {
      if (row.clientWidth === width) return
      width = row.clientWidth
      setFit(null)
    })
    observer.observe(row)
    // A font (weight) first used by these chips loads only after they render
    const onFonts = () => setFit(null)
    document.fonts.addEventListener('loadingdone', onFonts)
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', onFonts)
    }
  }, [hasRow])

  if (entries.length === 0) return null
  const measuring = fit === null
  const shown = measuring ? entries : entries.slice(0, fit)
  const hidden = measuring ? [] : entries.slice(fit)
  const chipClass = cn(CHIP_CLASS, choiceClassName)

  return (
    <TooltipProvider delay={120}>
      <div ref={rowRef} className="flex flex-wrap gap-1.5">
        {shown.map((entry) => {
          const label = labels[entry.key]
          return (
            <Tooltip key={entry.key}>
              <TooltipTrigger render={<span className={chipClass} />}>
                <ChipContent text={chipText(entry, label)} />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={6}
                className="max-w-72 flex-col items-start gap-1"
              >
                <span className="text-muted-foreground">
                  {entry.title}
                  {entry.isDefault && ` · ${t('blockNode.isDefault')}`}
                </span>
                {label ? (
                  <ValueLabelDetails label={label} />
                ) : (
                  <span className="font-mono break-all">{entry.value}</span>
                )}
              </TooltipContent>
            </Tooltip>
          )
        })}
        {measuring && (
          <span className={MORE_CLASS}>
            {t('blockNode.moreCount', { count: entries.length })}
          </span>
        )}
        {hidden.length > 0 && (
          <Tooltip>
            <TooltipTrigger render={<span className={MORE_CLASS} />}>
              {t('blockNode.moreCount', { count: hidden.length })}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-80">
              <span className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5">
                {hidden.map((entry) => (
                  <Fragment key={entry.key}>
                    <span className="text-muted-foreground">{entry.title}</span>
                    <span className="font-mono break-all">
                      {entry.value}
                      {entry.isDefault && (
                        <span className="ml-1.5 font-sans text-muted-foreground">
                          {t('blockNode.isDefault')}
                        </span>
                      )}
                    </span>
                  </Fragment>
                ))}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}
