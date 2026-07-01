/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Outputs grid with MIME filter, group-by toggle, skeletons for pending
 * items, and a lazy viewer for the active selection. */

import { Package } from 'lucide-react'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { registerFirstPartyAdapters } from './adapters'
import { GRIB_DIR_MIME } from './adapters/grib'
import { MimeFilterChips } from './MimeFilterChips'
import { OutputCard } from './OutputCard'
import { resolveAdapter } from './registry'
import { SkeletonOutputCard } from './SkeletonOutputCard'
import { needsSniff, useResolvedMimes } from './useResolvedMimes'
import type { JobStatus, RunOutputs } from '@/api/types/job.types'
import type { OutputAdapter, OutputItem } from './types'
import { isTerminalStatus } from '@/api/types/job.types'
import {
  useBlockHoverHandlers,
  useIsBlockHovered,
} from '@/features/executions/stores/executionHoverStore'
import { P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { groupByKey } from '@/lib/group-by'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Side-effect: adapter registration runs at module load. Idempotent.
registerFirstPartyAdapters()

// Single source of truth for the group-by enum: derive the type from the array
// so adding an option only requires touching this list and the i18n key map.
const GROUP_BY_OPTIONS = ['none', 'block', 'mime', 'block-and-mime'] as const
export type GroupBy = (typeof GROUP_BY_OPTIONS)[number]

/** Responsive card track — shared by the output grid and the loading
 * skeletons so both reflow identically. */
const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3'

interface OutputsViewProps {
  jobId: string
  status: JobStatus
  outputs: RunOutputs | null
  /** Drives the subtle highlight on currently-processing skeletons. */
  completedBlockIds?: ReadonlyArray<string> | null
  /** Surfaces block-level skeletons before any outputs payload arrives. */
  plannedBlockIds?: ReadonlyArray<string> | null
  /** Portal target for the toolbar; falls back to inline. */
  toolbarSlot?: HTMLElement | null
}

export function OutputsView({
  jobId,
  status,
  outputs,
  completedBlockIds,
  plannedBlockIds,
  toolbarSlot,
}: OutputsViewProps) {
  const { t } = useTranslation('executions')
  const navigate = useNavigate()
  const search = useSearch({ from: '/_authenticated/executions/$jobId' })
  const [activeViewer, setActiveViewer] = useState<{
    item: OutputItem
    adapter: OutputAdapter
  } | null>(null)

  /** Default order: by block (alphabetic), available before pending within
   * the same block, taskId for stable tiebreak. Keeps items from the same
   * block adjacent in the flat grid, and preserved as section/item order in
   * the grouped views. */
  const items = useMemo<Array<OutputItem>>(() => {
    if (!outputs) return []
    const list = Object.entries(outputs)
      // GRIB markers show in the Stored outputs card, not the grid.
      .filter(([, meta]) => meta.mime_type !== GRIB_DIR_MIME)
      .map(([taskId, meta]) => ({
        jobId,
        taskId,
        mimeType: meta.mime_type,
        originalBlock: meta.original_block,
        isAvailable: meta.is_available,
      }))
    list.sort((a, b) => {
      if (a.originalBlock !== b.originalBlock) {
        return a.originalBlock < b.originalBlock ? -1 : 1
      }
      if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1
      return a.taskId < b.taskId ? -1 : 1
    })
    return list
  }, [jobId, outputs])

  /** GRIB markers aren't grid cards, but still count toward the header tally
   * and block count. */
  const storedStats = useMemo(() => {
    let available = 0
    let pending = 0
    const blocks = new Set<string>()
    for (const meta of Object.values(outputs ?? {})) {
      if (meta.mime_type !== GRIB_DIR_MIME) continue
      blocks.add(meta.original_block)
      if (meta.is_available) available += 1
      else pending += 1
    }
    return { available, pending, blocks }
  }, [outputs])
  const hasStoredOutputs = storedStats.blocks.size > 0

  /** Sniffer-promoted mimes for the whole list. Resolved here, not per card,
   * so the filter can't hide an item before its real mime is known. */
  const resolvedMimes = useResolvedMimes(items)

  /** Sniffer-promoted mime if available, else the wire mime. */
  const effectiveMime = useCallback(
    (item: OutputItem): string => resolvedMimes[item.taskId] ?? item.mimeType,
    [resolvedMimes],
  )

  /** Distinct mimes + per-mime counts, drawn from available items only. */
  const { distinctMimes, mimeCounts, availableCount } = useMemo(() => {
    const counts: Record<string, number> = {}
    const order: Array<string> = []
    let availCount = 0
    for (const item of items) {
      if (!item.isAvailable) continue
      availCount += 1
      const mime = effectiveMime(item)
      if (!(mime in counts)) {
        order.push(mime)
        counts[mime] = 0
      }
      counts[mime] += 1
    }
    return {
      distinctMimes: order,
      mimeCounts: counts,
      availableCount: availCount,
    }
  }, [items, effectiveMime])

  const activeMimes = useMemo(() => parseMimes(search.mimes), [search.mimes])
  const groupBy: GroupBy = search.groupBy ?? 'none'

  const setActiveMimes = (next: ReadonlyArray<string>): void => {
    void navigate({
      to: '/executions/$jobId',
      params: { jobId },
      search: (prev) => ({
        ...prev,
        mimes: next.length > 0 ? next.join(',') : undefined,
      }),
      replace: true,
    })
  }

  const setGroupBy = (next: GroupBy): void => {
    void navigate({
      to: '/executions/$jobId',
      params: { jobId },
      search: (prev) => ({
        ...prev,
        groupBy: next === 'none' ? undefined : next,
      }),
      replace: true,
    })
  }

  /** Synthesised placeholders when the outputs payload has no rows yet. */
  const blockSkeletons = useMemo<Array<OutputItem>>(() => {
    if (items.length > 0) return []
    // Skeletons are for in-progress runs only.
    if (isTerminalStatus(status)) return []
    if (!plannedBlockIds || plannedBlockIds.length === 0) return []
    return (
      plannedBlockIds
        // GRIB sink blocks belong to the Stored outputs card.
        .filter((blockId) => !storedStats.blocks.has(blockId))
        .map((blockId) => ({
          jobId,
          taskId: `__planned__:${blockId}`,
          mimeType: 'application/octet-stream',
          originalBlock: blockId,
          isAvailable: false,
        }))
    )
  }, [items.length, plannedBlockIds, jobId, status, storedStats])

  /** Distinct source blocks in the run. The group-by control only earns its
   * place — and is only shown — when there's more than one. */
  const distinctBlockCount = useMemo(() => {
    const source = items.length > 0 ? items : blockSkeletons
    const blocks = new Set(source.map((item) => item.originalBlock))
    for (const block of storedStats.blocks) blocks.add(block)
    return blocks.size
  }, [items, blockSkeletons, storedStats])

  /** Available items still awaiting a sniff. A `?mimes=` filter can't decide
   * them yet, so they stand in as skeletons rather than a premature empty
   * state. */
  const pendingSniffItems = useMemo(
    () =>
      items.filter(
        (item) => needsSniff(item) && !(item.taskId in resolvedMimes),
      ),
    [items, resolvedMimes],
  )

  /** Single filter pass over the unified list (or synthesised fallback).
   * Counts shown in the toolbar are derived from this same pass. */
  const { visibleItems, visibleAvailableCount, visiblePendingCount } =
    useMemo(() => {
      const source = items.length > 0 ? items : blockSkeletons
      const visible: Array<OutputItem> = []
      let available = 0
      let pending = 0
      for (const item of source) {
        if (
          activeMimes.length > 0 &&
          !activeMimes.includes(effectiveMime(item))
        ) {
          continue
        }
        visible.push(item)
        if (item.isAvailable) available += 1
        else pending += 1
      }
      return {
        visibleItems: visible,
        visibleAvailableCount: available,
        visiblePendingCount: pending,
      }
    }, [items, blockSkeletons, activeMimes, effectiveMime])

  const isRunning = !isTerminalStatus(status)

  /** Planned − completed while the run is in progress; drives the subtle
   * amber accent on skeletons whose block is the one currently executing. */
  const runningBlockSet = useMemo<ReadonlySet<string>>(() => {
    if (!isRunning || !plannedBlockIds) return new Set()
    const completed = new Set(completedBlockIds ?? [])
    const running = new Set<string>()
    for (const id of plannedBlockIds) {
      if (!completed.has(id)) running.add(id)
    }
    return running
  }, [isRunning, plannedBlockIds, completedBlockIds])
  const ActiveViewer = activeViewer?.adapter.Viewer ?? null

  /** True empty: no outputs payload AND no planned blocks. */
  if (items.length === 0 && blockSkeletons.length === 0) {
    // GRIB-only run — the Stored outputs card covers it; render nothing.
    if (hasStoredOutputs) return null
    return (
      <Card
        variant="flat"
        shadow="none"
        className="gap-0 overflow-hidden bg-transparent py-0"
      >
        <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <P className="font-medium text-muted-foreground">
            {t('outputs.noOutputs')}
          </P>
          {isRunning && (
            <P className="text-muted-foreground">
              {t('outputs.noOutputsRunning')}
            </P>
          )}
        </div>
      </Card>
    )
  }

  // Fold stored markers into the tally so it spans the whole run.
  const shownAvailable = visibleAvailableCount + storedStats.available
  const totalAvailable = availableCount + storedStats.available
  const shownPending = visiblePendingCount + storedStats.pending

  const toolbar = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <P className="text-muted-foreground">
        {t('outputs.generated')}: {shownAvailable}
        {shownAvailable !== totalAvailable && ` / ${totalAvailable}`}
        {shownPending > 0 && (
          <span className="ml-2">
            · {t('outputs.pending')}: {shownPending}
          </span>
        )}
      </P>
      <div className="flex flex-wrap items-center gap-3">
        {distinctMimes.length > 1 && (
          <MimeFilterChips
            availableMimes={distinctMimes}
            activeMimes={activeMimes}
            counts={mimeCounts}
            total={availableCount}
            onChange={setActiveMimes}
          />
        )}
        {distinctBlockCount > 1 && (
          <GroupBySelect value={groupBy} onChange={setGroupBy} />
        )}
      </div>
    </div>
  )

  return (
    <Card
      variant="flat"
      shadow="none"
      // overflow-visible: the Card base would clip the first row's outer corners.
      className="gap-0 overflow-visible bg-transparent py-0"
    >
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}
      {/* No top padding — the parent's space-y-4 sets the gap above the grid. */}
      <div className="space-y-3 pb-3">
        {!toolbarSlot && toolbar}

        {visibleItems.length === 0 ? (
          // A `?mimes=` filter from the URL can match nothing until opaque
          // items finish sniffing; show skeletons for those rather than a
          // "no match" that a moment later turns out wrong.
          pendingSniffItems.length > 0 ? (
            <div className={GRID_CLASS}>
              {pendingSniffItems.map((item) => (
                <SkeletonOutputCard
                  key={item.taskId}
                  originalBlock={item.originalBlock}
                />
              ))}
            </div>
          ) : (
            <P className="px-1 py-6 text-center text-sm text-muted-foreground">
              {t('outputs.noMatch')}
            </P>
          )
        ) : (
          <GroupedGrid
            groupBy={groupBy}
            items={visibleItems}
            runningBlockSet={runningBlockSet}
            effectiveMime={effectiveMime}
            onOpenViewer={(item, adapter) => setActiveViewer({ item, adapter })}
          />
        )}
      </div>

      {ActiveViewer && activeViewer && (
        <ActiveViewerHost
          ActiveViewer={ActiveViewer}
          activeViewer={activeViewer}
          visibleItems={visibleItems}
          effectiveMime={effectiveMime}
          setActiveViewer={setActiveViewer}
        />
      )}
    </Card>
  )
}

interface ActiveViewerHostProps {
  ActiveViewer: NonNullable<OutputAdapter['Viewer']>
  activeViewer: { item: OutputItem; adapter: OutputAdapter }
  visibleItems: ReadonlyArray<OutputItem>
  effectiveMime: (item: OutputItem) => string
  setActiveViewer: (
    next: { item: OutputItem; adapter: OutputAdapter } | null,
  ) => void
}

/** Wires prev/next/hotkeys; mounts only while a viewer is open. */
function ActiveViewerHost({
  ActiveViewer,
  activeViewer,
  visibleItems,
  effectiveMime,
  setActiveViewer,
}: ActiveViewerHostProps) {
  const activeIndex = visibleItems.findIndex(
    (it) => it.taskId === activeViewer.item.taskId,
  )
  const prevItem = activeIndex > 0 ? visibleItems[activeIndex - 1] : null
  const nextItem =
    activeIndex >= 0 && activeIndex < visibleItems.length - 1
      ? visibleItems[activeIndex + 1]
      : null

  const stepTo = useCallback(
    (item: OutputItem) =>
      setActiveViewer({
        item,
        adapter: resolveAdapter(effectiveMime(item)),
      }),
    [setActiveViewer, effectiveMime],
  )

  const goPrev = useCallback(() => {
    if (prevItem) stepTo(prevItem)
  }, [prevItem, stepTo])
  const goNext = useCallback(() => {
    if (nextItem) stepTo(nextItem)
  }, [nextItem, stepTo])

  // Arrow + vi-style output nav (PDF page nav stays on header buttons).
  useHotkey('ArrowLeft', goPrev, { enabled: !!prevItem, ignoreInputs: true })
  useHotkey('K', goPrev, { enabled: !!prevItem, ignoreInputs: true })
  useHotkey('ArrowRight', goNext, { enabled: !!nextItem, ignoreInputs: true })
  useHotkey('J', goNext, { enabled: !!nextItem, ignoreInputs: true })

  return (
    <Suspense fallback={null}>
      <ActiveViewer
        // Fresh mount per item resets pan/zoom/page.
        key={activeViewer.item.taskId}
        item={activeViewer.item}
        adapter={activeViewer.adapter}
        onClose={() => {
          setActiveViewer(null)
        }}
        onPrev={prevItem ? goPrev : undefined}
        onNext={nextItem ? goNext : undefined}
        navIndex={
          activeIndex >= 0
            ? { current: activeIndex + 1, total: visibleItems.length }
            : undefined
        }
      />
    </Suspense>
  )
}

interface GroupedGridProps {
  groupBy: GroupBy
  items: ReadonlyArray<OutputItem>
  runningBlockSet: ReadonlySet<string>
  effectiveMime: (item: OutputItem) => string
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
}

function GroupedGrid({
  groupBy,
  items,
  runningBlockSet,
  effectiveMime,
  onOpenViewer,
}: GroupedGridProps) {
  if (groupBy === 'none') {
    return (
      <FlexGrid
        items={items}
        runningBlockSet={runningBlockSet}
        effectiveMime={effectiveMime}
        onOpenViewer={onOpenViewer}
      />
    )
  }

  if (groupBy === 'block') {
    const groups = groupByKey(items, (i) => i.originalBlock)
    return (
      <div className="space-y-5">
        {groups.map(([block, groupItems]) => (
          <Section
            key={block}
            title={block}
            count={groupItems.length}
            blockId={block}
          >
            <FlexGrid
              items={groupItems}
              runningBlockSet={runningBlockSet}
              effectiveMime={effectiveMime}
              onOpenViewer={onOpenViewer}
            />
          </Section>
        ))}
      </div>
    )
  }

  if (groupBy === 'mime') {
    const groups = groupByKey(items, effectiveMime)
    return (
      <div className="space-y-5">
        {groups.map(([mime, groupItems]) => (
          <Section
            key={mime}
            title={<MimeSectionLabel mime={mime} />}
            count={groupItems.length}
          >
            <FlexGrid
              items={groupItems}
              runningBlockSet={runningBlockSet}
              effectiveMime={effectiveMime}
              onOpenViewer={onOpenViewer}
            />
          </Section>
        ))}
      </div>
    )
  }

  // 'block-and-mime': outer = block, inner = mime
  const byBlock = groupByKey(items, (i) => i.originalBlock)
  return (
    <div className="space-y-6">
      {byBlock.map(([block, blockItems]) => {
        const byMime = groupByKey(blockItems, effectiveMime)
        return (
          <Section
            key={block}
            title={block}
            count={blockItems.length}
            blockId={block}
          >
            <div className="space-y-4">
              {byMime.map(([mime, mimeItems]) => (
                <Subsection
                  key={mime}
                  title={<MimeSectionLabel mime={mime} />}
                  count={mimeItems.length}
                >
                  <FlexGrid
                    items={mimeItems}
                    runningBlockSet={runningBlockSet}
                    effectiveMime={effectiveMime}
                    onOpenViewer={onOpenViewer}
                  />
                </Subsection>
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

interface FlexGridProps {
  items: ReadonlyArray<OutputItem>
  runningBlockSet: ReadonlySet<string>
  effectiveMime: (item: OutputItem) => string
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
}

function FlexGrid({
  items,
  runningBlockSet,
  effectiveMime,
  onOpenViewer,
}: FlexGridProps) {
  return (
    <div className={GRID_CLASS}>
      {items.map((item) => (
        <FlexGridItem
          key={item.taskId}
          item={item}
          isRunning={runningBlockSet.has(item.originalBlock)}
          effectiveMime={effectiveMime}
          onOpenViewer={onOpenViewer}
        />
      ))}
    </div>
  )
}

// Per-item subscription keeps hover-driven re-renders scoped to the matching block.
function FlexGridItem({
  item,
  isRunning,
  effectiveMime,
  onOpenViewer,
}: {
  item: OutputItem
  isRunning: boolean
  effectiveMime: (item: OutputItem) => string
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
}) {
  const isHovered = useIsBlockHovered(item.originalBlock)
  const handlers = useBlockHoverHandlers(item.originalBlock)
  return (
    <div
      {...handlers}
      className={cn(
        'rounded-lg transition-colors',
        isHovered && 'bg-primary/10',
      )}
    >
      {item.isAvailable ? (
        <OutputCard
          item={item}
          adapter={resolveAdapter(effectiveMime(item))}
          onOpenViewer={onOpenViewer}
        />
      ) : (
        <SkeletonOutputCard
          originalBlock={item.originalBlock}
          isRunning={isRunning}
        />
      )}
    </div>
  )
}

function Section({
  title,
  count,
  children,
  blockId,
}: {
  title: React.ReactNode
  count: number
  children: React.ReactNode
  /** When set, hover on the section triggers the canvas-block highlight. */
  blockId?: string
}) {
  const handlers = useBlockHoverHandlers(blockId ?? null)
  return (
    <section className="space-y-2" {...handlers}>
      <header className="flex items-baseline gap-2">
        <h3
          className="truncate font-mono text-sm font-semibold text-foreground"
          title={typeof title === 'string' ? title : undefined}
        >
          {title}
        </h3>
        <span className="text-sm text-muted-foreground">({count})</span>
      </header>
      {children}
    </section>
  )
}

function Subsection({
  title,
  count,
  children,
}: {
  title: React.ReactNode
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 pl-3">
      <header className="flex items-baseline gap-2">
        <h4 className="truncate text-sm font-medium text-muted-foreground">
          {title}
        </h4>
        <span className="text-sm text-muted-foreground/70">({count})</span>
      </header>
      {children}
    </section>
  )
}

/** Resolve a human label for a mime group header via the registry. */
function MimeSectionLabel({ mime }: { mime: string }) {
  const { t } = useTranslation('executions')
  return <>{resolveAdapter(mime).label(t)}</>
}

function GroupBySelect({
  value,
  onChange,
}: {
  value: GroupBy
  onChange: (next: GroupBy) => void
}) {
  const { t } = useTranslation('executions')
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {t('outputs.groupBy.label')}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as GroupBy)}>
        <SelectTrigger className="h-8 w-44 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GROUP_BY_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {t(groupByI18nKey(option))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function groupByI18nKey(
  option: GroupBy,
):
  | 'outputs.groupBy.none'
  | 'outputs.groupBy.block'
  | 'outputs.groupBy.mime'
  | 'outputs.groupBy.blockAndMime' {
  switch (option) {
    case 'none':
      return 'outputs.groupBy.none'
    case 'block':
      return 'outputs.groupBy.block'
    case 'mime':
      return 'outputs.groupBy.mime'
    case 'block-and-mime':
      return 'outputs.groupBy.blockAndMime'
  }
}

/**
 * Comma-joined `mimes` query param; empty / missing means "All". Filtered
 * for a passing visual check — we don't validate against an enum because
 * MIMEs are open-ended (third-party adapters may register new ones).
 */
function parseMimes(raw: string | undefined): Array<string> {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
