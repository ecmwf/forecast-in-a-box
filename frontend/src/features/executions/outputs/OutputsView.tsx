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
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { registerFirstPartyAdapters } from './adapters'
import { MimeFilterChips } from './MimeFilterChips'
import { OutputCard } from './OutputCard'
import { resolveAdapter } from './registry'
import { SkeletonOutputCard } from './SkeletonOutputCard'
import { useResolvedAdapter } from './useResolvedAdapter'
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
  const [resolvedMimes, setResolvedMimes] = useState<Record<string, string>>({})

  const handleResolved = useCallback((taskId: string, mime: string) => {
    setResolvedMimes((prev) =>
      prev[taskId] === mime ? prev : { ...prev, [taskId]: mime },
    )
  }, [])

  /** Default order: by block (alphabetic), available before pending within
   * the same block, taskId for stable tiebreak. Keeps items from the same
   * block adjacent in the flat grid, and preserved as section/item order in
   * the grouped views. */
  const items = useMemo<Array<OutputItem>>(() => {
    if (!outputs) return []
    const list = Object.entries(outputs).map(([taskId, meta]) => ({
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
    if (!plannedBlockIds || plannedBlockIds.length === 0) return []
    return plannedBlockIds.map((blockId) => ({
      jobId,
      taskId: `__planned__:${blockId}`,
      mimeType: 'application/octet-stream',
      originalBlock: blockId,
      isAvailable: false,
    }))
  }, [items.length, plannedBlockIds, jobId])

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

  const toolbar = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <P className="text-muted-foreground">
        {t('outputs.generated')}: {visibleAvailableCount}
        {visibleAvailableCount !== availableCount && ` / ${availableCount}`}
        {visiblePendingCount > 0 && (
          <span className="ml-2">
            · {t('outputs.pending')}: {visiblePendingCount}
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
        <GroupBySelect value={groupBy} onChange={setGroupBy} />
      </div>
    </div>
  )

  return (
    <Card
      variant="flat"
      shadow="none"
      className="gap-0 overflow-hidden bg-transparent py-0"
    >
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}
      <div className="space-y-3 py-3">
        {!toolbarSlot && toolbar}

        {visibleItems.length === 0 ? (
          <P className="px-1 py-6 text-center text-sm text-muted-foreground">
            {t('outputs.noMatch')}
          </P>
        ) : (
          <GroupedGrid
            groupBy={groupBy}
            items={visibleItems}
            runningBlockSet={runningBlockSet}
            effectiveMime={effectiveMime}
            onOpenViewer={(item, adapter) => setActiveViewer({ item, adapter })}
            onResolved={handleResolved}
          />
        )}
      </div>

      {ActiveViewer && activeViewer && (
        <Suspense fallback={null}>
          <ActiveViewer
            item={activeViewer.item}
            adapter={activeViewer.adapter}
            onClose={() => setActiveViewer(null)}
          />
        </Suspense>
      )}
    </Card>
  )
}

interface GroupedGridProps {
  groupBy: GroupBy
  items: ReadonlyArray<OutputItem>
  runningBlockSet: ReadonlySet<string>
  effectiveMime: (item: OutputItem) => string
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
  onResolved: (taskId: string, mime: string) => void
}

function GroupedGrid({
  groupBy,
  items,
  runningBlockSet,
  effectiveMime,
  onOpenViewer,
  onResolved,
}: GroupedGridProps) {
  if (groupBy === 'none') {
    return (
      <FlexGrid
        items={items}
        runningBlockSet={runningBlockSet}
        onOpenViewer={onOpenViewer}
        onResolved={onResolved}
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
              onOpenViewer={onOpenViewer}
              onResolved={onResolved}
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
              onOpenViewer={onOpenViewer}
              onResolved={onResolved}
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
                    onOpenViewer={onOpenViewer}
                    onResolved={onResolved}
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
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
  onResolved: (taskId: string, mime: string) => void
}

function FlexGrid({
  items,
  runningBlockSet,
  onOpenViewer,
  onResolved,
}: FlexGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
      {items.map((item) => (
        <FlexGridItem
          key={item.taskId}
          item={item}
          isRunning={runningBlockSet.has(item.originalBlock)}
          onOpenViewer={onOpenViewer}
          onResolved={onResolved}
        />
      ))}
    </div>
  )
}

// Per-item subscription keeps hover-driven re-renders scoped to the matching block.
function FlexGridItem({
  item,
  isRunning,
  onOpenViewer,
  onResolved,
}: {
  item: OutputItem
  isRunning: boolean
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
  onResolved: (taskId: string, mime: string) => void
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
        <OutputCardSlot
          item={item}
          onOpenViewer={onOpenViewer}
          onResolved={onResolved}
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

/** Per-item slot: resolves the (possibly sniff-promoted) adapter, reports
 * the resolved mime up so the parent can include it in chips/filter, and
 * renders an OutputCard. */
function OutputCardSlot({
  item,
  onOpenViewer,
  onResolved,
}: {
  item: OutputItem
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
  onResolved: (taskId: string, mime: string) => void
}) {
  const { adapter, effectiveMime } = useResolvedAdapter(item)
  useEffect(() => {
    // Only report on sniffer promotion. The wire mime is already known to
    // the parent via `item.mimeType` and reporting it on every remount can
    // overwrite a previously-resolved mime (causing chips to flicker to
    // "File" while the sniff re-runs after a filter toggle).
    if (effectiveMime !== item.mimeType) {
      onResolved(item.taskId, effectiveMime)
    }
  }, [item.taskId, item.mimeType, effectiveMime, onResolved])
  return (
    <OutputCard item={item} adapter={adapter} onOpenViewer={onOpenViewer} />
  )
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
