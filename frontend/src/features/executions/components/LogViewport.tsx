/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Log lines in a scroll box that draws only the rows in view. */

import { useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactNode, Ref } from 'react'
import type { LogLevel } from '@/features/executions/utils/run-logs'
import { cn } from '@/lib/utils'

export type LogViewRow =
  | {
      kind: 'line'
      number: number
      text: string
      level: LogLevel | null
      /** Set in "All files", where lines open their file. */
      file?: string
      highlighted?: boolean
    }
  | {
      kind: 'section'
      file: string
      label: string
      caption: string
      /** Drawn without the rule above. */
      first: boolean
    }
  | { kind: 'note'; text: string }

export interface LogViewportHandle {
  scrollToRow: (index: number, align: 'start' | 'center' | 'end') => void
  /** Within a few pixels of the bottom. */
  isAtEnd: () => boolean
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: '',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-destructive',
}

/** Slack for "scrolled to the end". */
const END_SLACK_PX = 24
// A text-sm line at leading-relaxed, rounded as the virtualizer measures.
const ROW_PX = 23
const SECTION_ESTIMATE_PX = 45

interface LogViewportProps {
  count: number
  row: (index: number) => LogViewRow
  wrap: boolean
  /** Digits of the largest line number. */
  numberDigits: number
  /** Has section rows, which are taller. */
  hasSections?: boolean
  /** Lower-case text to mark in each line. */
  highlight?: string
  /** Row sizes are measured again when this changes. */
  layoutKey?: unknown
  onLineClick?: (file: string, line: number) => void
  /** Shown at the end of each section header. */
  sectionAction?: (file: string, label: string) => ReactNode
  handleRef?: Ref<LogViewportHandle>
  className?: string
}

export function LogViewport({
  count,
  row,
  wrap,
  numberDigits,
  hasSections = false,
  highlight = '',
  layoutKey,
  onLineClick,
  sectionAction,
  handleRef,
  className,
}: LogViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      hasSections && row(index).kind === 'section'
        ? SECTION_ESTIMATE_PX
        : ROW_PX,
    overscan: 30,
  })

  // Sizes measured for other rows or another wrap mode no longer hold.
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, wrap, layoutKey])

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToRow: (index, align) => {
        if (count > 0) virtualizer.scrollToIndex(index, { align })
      },
      isAtEnd: () => {
        const el = scrollRef.current
        if (!el) return true
        return el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK_PX
      },
    }),
    [virtualizer, count],
  )

  const items = virtualizer.getVirtualItems()
  return (
    <div
      ref={scrollRef}
      data-slot="code-block-content"
      tabIndex={0}
      className={cn(
        'min-h-0 min-w-0 scrollbar-thin overflow-auto py-2 font-mono leading-relaxed outline-none',
        className,
      )}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        <div
          className={cn(
            'absolute top-0 left-0',
            wrap ? 'w-full' : 'min-w-full',
          )}
          style={{ transform: `translateY(${items.at(0)?.start ?? 0}px)` }}
        >
          {items.map((item) => {
            const shown = row(item.index)
            // Unwrapped lines are all ROW_PX tall: nothing to measure.
            const measure = wrap || shown.kind === 'section'
            return (
              <div
                key={item.key}
                ref={measure ? virtualizer.measureElement : undefined}
                data-index={item.index}
              >
                <Row
                  row={shown}
                  highlight={highlight}
                  wrap={wrap}
                  numberDigits={numberDigits}
                  onLineClick={onLineClick}
                  sectionAction={sectionAction}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Row({
  row,
  highlight,
  wrap,
  numberDigits,
  onLineClick,
  sectionAction,
}: {
  row: LogViewRow
  highlight: string
  wrap: boolean
  numberDigits: number
  onLineClick?: (file: string, line: number) => void
  sectionAction?: (file: string, label: string) => ReactNode
}) {
  if (row.kind === 'section') {
    return (
      <div
        data-slot="log-section"
        className={cn(
          'flex items-center gap-2 px-4 pb-1 font-sans text-xs select-none',
          !row.first && 'mt-3 border-t pt-3',
        )}
      >
        <span className="font-medium text-foreground">{row.label}</span>
        <span className="text-muted-foreground">{row.caption}</span>
        {sectionAction?.(row.file, row.label)}
      </div>
    )
  }
  if (row.kind === 'note') {
    return (
      <div
        data-slot="log-note"
        style={{ height: ROW_PX }}
        className="flex items-center gap-3 px-4 font-sans text-xs text-muted-foreground select-none before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
      >
        {row.text}
      </div>
    )
  }
  const { file } = row
  const clickable = file !== undefined && onLineClick !== undefined
  return (
    <div
      data-line={row.number}
      data-file={file}
      data-variant={row.highlighted ? 'highlighted' : undefined}
      style={wrap ? undefined : { height: ROW_PX }}
      className={cn(
        'flex gap-3 px-4',
        row.highlighted && 'bg-muted',
        row.level && LEVEL_CLASS[row.level],
        clickable && 'cursor-pointer hover:bg-muted/60',
        !wrap && 'w-max min-w-full',
      )}
      onClick={
        clickable
          ? () => {
              // Ignore text selection.
              if (window.getSelection()?.toString()) return
              onLineClick(file, row.number)
            }
          : undefined
      }
    >
      <span
        className="shrink-0 text-end text-muted-foreground select-none"
        style={{ width: `${numberDigits}ch` }}
      >
        {row.number}
      </span>
      <span
        className={cn(
          'min-w-0',
          wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
        )}
      >
        {row.text ? <Marked text={row.text} query={highlight} /> : ' '}
      </span>
    </div>
  )
}

/** `text` with each case-insensitive `query` match marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase()
  // Lower-casing that changes lengths would shift the marks.
  if (!query || lower.length !== text.length) return text
  const parts: Array<ReactNode> = []
  let from = 0
  let at = lower.indexOf(query)
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark
        key={at}
        className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-400/30"
      >
        {text.slice(at, at + query.length)}
      </mark>,
    )
    from = at + query.length
    at = lower.indexOf(query, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}
