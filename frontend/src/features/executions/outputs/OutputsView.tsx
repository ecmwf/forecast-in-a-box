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

import { AlertTriangle, CloudOff, Package } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { registerFirstPartyAdapters } from './adapters'
import { isGribDirMime } from './adapters/grib'
import {
  SETTING_PREFIX,
  compareDimValues,
  compareDims,
  dimLine,
  dimNeighbor,
  dimValue,
  dimValueCounts,
  matchesDimFilter,
  orderDims,
  outputTitle,
  parseDimFilter,
  segmentKey,
  serializeDimFilter,
  stepGrid,
} from './dims'
import { DimFilterMenu } from './DimFilterMenu'
import { MimeFilterChips } from './MimeFilterChips'
import { OutputCard } from './OutputCard'
import { resolveAdapter } from './registry'
import { SkeletonOutputCard } from './SkeletonOutputCard'
import { StepGridMenu } from './StepGridMenu'
import { DimNavigator } from './viewers/DimNavigator'
import { Filmstrip } from './viewers/Filmstrip'
import { useDimFormat } from './useDimFormat'
import { prefetchJobResultBlob } from './useJobResult'
import { needsSniff, useResolvedMimes } from './useResolvedMimes'
import { classifyOutput } from './availability'
import type { LostTaskIds } from './availability'
import type { BlockSettings } from './block-settings'
import type { DimFilter, OutputDim } from './dims'
import type { DimFormat } from './useDimFormat'
import type { JobStatus, RunOutputs } from '@/api/types/job.types'
import type { OutputAdapter, OutputItem } from './types'
import { isTerminalStatus } from '@/api/types/job.types'
import {
  useBlockHoverHandlers,
  useIsBlockHovered,
} from '@/features/executions/stores/executionHoverStore'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { groupByKey } from '@/lib/group-by'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
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
/** Grouping by a split coordinate is `dim:<key>`, e.g. `dim:param`. */
const DIM_PREFIX = 'dim:'
export type GroupBy = (typeof GROUP_BY_OPTIONS)[number] | `dim:${string}`

/** Delay between frames while playing through a coordinate. */
const PLAY_INTERVAL_MS = 700

/** Responsive card track — shared by the output grid and the loading
 * skeletons so both reflow identically. */
const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3'

interface OutputsViewProps {
  jobId: string
  status: JobStatus
  outputs: RunOutputs | null
  /** Reasons for outputs that are no longer retrievable. */
  lostTaskIds?: LostTaskIds
  /** Drives the subtle highlight on currently-processing skeletons. */
  completedBlockIds?: ReadonlyArray<string> | null
  /** Surfaces block-level skeletons before any outputs payload arrives. */
  plannedBlockIds?: ReadonlyArray<string> | null
  /** Display name per block id, from the run's workflow. */
  blockNames?: Readonly<Record<string, string>>
  /** Options differing between same-type blocks. */
  blockSettings?: BlockSettings
  /** Portal target for the toolbar; falls back to inline. */
  toolbarSlot?: HTMLElement | null
  /** Switches to the Logs tab from the failed-run notice. */
  onViewLogs?: () => void
}

export function OutputsView({
  jobId,
  status,
  outputs,
  lostTaskIds = {},
  completedBlockIds,
  plannedBlockIds,
  blockNames,
  blockSettings,
  toolbarSlot,
  onViewLogs,
}: OutputsViewProps) {
  const { t } = useTranslation('executions')
  const navigate = useNavigate()
  const search = useSearch({ from: '/_authenticated/execute/$jobId' })
  const [activeViewer, setActiveViewer] = useState<{
    item: OutputItem
    adapter: OutputAdapter
  } | null>(null)

  const dimFormat = useDimFormat(outputs, blockSettings)

  /** Block settings as prefixed pairs. */
  const settingsOf = useCallback(
    (blockId: string): Array<OutputDim> | undefined =>
      blockSettings?.[blockId]?.map(({ key, value }) => [
        `${SETTING_PREFIX}${key}`,
        value,
      ]),
    [blockSettings],
  )

  /** Block, settings, coordinates (time last), taskId; pending keep slots. */
  const items = useMemo<Array<OutputItem>>(() => {
    if (!outputs) return []
    const list = Object.entries(outputs)
      // GRIB markers show in the Stored outputs card, not the grid.
      .filter(([, meta]) => !isGribDirMime(meta.mime_type))
      .map(([taskId, meta]) => {
        const availability = classifyOutput(
          meta.is_available,
          taskId,
          lostTaskIds,
        )
        const dims = meta.dimension_kvs ?? undefined
        const settings = settingsOf(meta.original_block)
        const coords = [...(settings ?? []), ...(dims ?? [])]
        const split = coords.length > 0
        // Plugin label only for outputs without coordinates.
        const label =
          meta.dimension_kvs == null
            ? (meta.display_name ?? undefined)
            : undefined
        return {
          jobId,
          taskId,
          mimeType: meta.mime_type,
          originalBlock: meta.original_block,
          blockName: blockNames?.[meta.original_block] ?? meta.original_block,
          dims,
          settings,
          subtitle: split ? dimFormat.dims(coords, 'compact') : label,
          subtitleFull: split ? dimFormat.dims(coords, 'full') : label,
          isAvailable: meta.is_available,
          lostReason:
            availability.state === 'lost' ? availability.reason : undefined,
        }
      })
    list.sort((a, b) => {
      if (a.blockName !== b.blockName) {
        return a.blockName.localeCompare(b.blockName)
      }
      if (a.originalBlock !== b.originalBlock) {
        const bySettings = compareDimValues(settingValues(a), settingValues(b))
        if (bySettings !== 0) return bySettings
        return a.originalBlock < b.originalBlock ? -1 : 1
      }
      const byDims = compareDims(a, b)
      if (byDims !== 0) return byDims
      return a.taskId < b.taskId ? -1 : 1
    })
    return list
  }, [jobId, outputs, lostTaskIds, blockNames, settingsOf, dimFormat])

  /** GRIB markers aren't grid cards, but still count toward the header tally
   * and block count. */
  const storedStats = useMemo(() => {
    let available = 0
    let pending = 0
    let lost = 0
    const blocks = new Set<string>()
    for (const [taskId, meta] of Object.entries(outputs ?? {})) {
      if (!isGribDirMime(meta.mime_type)) continue
      blocks.add(meta.original_block)
      switch (classifyOutput(meta.is_available, taskId, lostTaskIds).state) {
        case 'available':
          available += 1
          break
        case 'lost':
          lost += 1
          break
        default:
          pending += 1
      }
    }
    return { available, pending, lost, blocks }
  }, [outputs, lostTaskIds])
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

  /** Varying settings and coordinates with their values, outer to inner. */
  const splitDims = useMemo(
    () =>
      [...dimValueCounts(items)]
        .map(([key, counts]) => [key, counts.map(([value]) => value)] as const)
        .filter(([, values]) => values.length > 1),
    [items],
  )
  const splitKeys = useMemo(() => splitDims.map(([key]) => key), [splitDims])

  /** Day x hour grid for multi-day steps. */
  const stepLayout = useMemo(() => {
    const steps = splitDims.find(([key]) => key === 'step')?.[1].map(Number)
    const grid = steps ? stepGrid(steps) : null
    return steps && grid ? { steps, grid } : null
  }, [splitDims])

  /** URL coordinate filter, limited to coordinates that vary. */
  const dimFilter = useMemo<DimFilter>(
    () =>
      Object.fromEntries(
        Object.entries(parseDimFilter(search.dims)).filter(([key]) =>
          splitKeys.includes(key),
        ),
      ),
    [search.dims, splitKeys],
  )

  /** Per-step counts under the other filters, and produced steps. */
  const stepStats = useMemo(() => {
    const counts = new Map<number, number>()
    const produced = new Set<number>()
    const { step: _, ...others } = dimFilter
    for (const item of items) {
      const raw = dimValue(item, 'step')
      if (raw === undefined || !matchesDimFilter(item, others)) continue
      if (
        activeMimes.length > 0 &&
        !activeMimes.includes(effectiveMime(item))
      ) {
        continue
      }
      const step = Number(raw)
      counts.set(step, (counts.get(step) ?? 0) + 1)
      if (item.isAvailable) produced.add(step)
    }
    return { counts, produced }
  }, [items, dimFilter, activeMimes, effectiveMime])

  const requestedGroupBy: GroupBy = search.groupBy ?? 'none'
  // Unknown coordinate: flat grid.
  const groupBy: GroupBy =
    requestedGroupBy.startsWith(DIM_PREFIX) &&
    !splitKeys.includes(requestedGroupBy.slice(DIM_PREFIX.length))
      ? 'none'
      : requestedGroupBy

  const setActiveMimes = (next: ReadonlyArray<string>): void => {
    void navigate({
      to: '/execute/$jobId',
      params: { jobId },
      search: (prev) => ({
        ...prev,
        mimes: next.length > 0 ? next.join(',') : undefined,
      }),
      replace: true,
    })
  }

  /** `null` clears the coordinate's filter; `[]` keeps none of its values. */
  const setDimValues = (
    key: string,
    values: ReadonlyArray<string> | null,
  ): void => {
    const others = Object.entries(dimFilter).filter(([k]) => k !== key)
    void navigate({
      to: '/execute/$jobId',
      params: { jobId },
      search: (prev) => ({
        ...prev,
        dims: serializeDimFilter(
          Object.fromEntries(values ? [...others, [key, values]] : others),
        ),
      }),
      replace: true,
    })
  }

  const setGroupBy = (next: GroupBy): void => {
    void navigate({
      to: '/execute/$jobId',
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
        .map((blockId) => {
          const settings = settingsOf(blockId)
          return {
            jobId,
            taskId: `__planned__:${blockId}`,
            mimeType: 'application/octet-stream',
            blockName: blockNames?.[blockId] ?? blockId,
            originalBlock: blockId,
            settings,
            subtitle: settings && dimFormat.dims(settings, 'compact'),
            isAvailable: false,
          }
        })
    )
  }, [
    items.length,
    plannedBlockIds,
    jobId,
    status,
    storedStats,
    blockNames,
    settingsOf,
    dimFormat,
  ])

  /** Distinct source blocks in the run. The group-by control only earns its
   * place — and is only shown — when there's more than one. */
  const distinctBlockCount = useMemo(() => {
    const source = items.length > 0 ? items : blockSkeletons
    const blocks = new Set(source.map((item) => item.originalBlock))
    for (const block of storedStats.blocks) blocks.add(block)
    return blocks.size
  }, [items, blockSkeletons, storedStats])

  /** Block groupings need several blocks; coordinate ones need a split. */
  const groupByOptions = useMemo<Array<GroupBy>>(
    () => [
      ...(distinctBlockCount > 1 ? GROUP_BY_OPTIONS : (['none'] as const)),
      ...splitKeys.map((key): GroupBy => `${DIM_PREFIX}${key}`),
    ],
    [distinctBlockCount, splitKeys],
  )

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
  const {
    visibleItems,
    visibleAvailableCount,
    visiblePendingCount,
    visibleLostCount,
  } = useMemo(() => {
    const source = items.length > 0 ? items : blockSkeletons
    const visible: Array<OutputItem> = []
    let available = 0
    let pending = 0
    let lost = 0
    for (const item of source) {
      const isPending = !item.isAvailable && item.lostReason === undefined
      // Failed run: never-arriving items are tallied for the notice, not shown
      // as skeletons (and the mime filter can't hide what was expected).
      if (status === 'failed' && isPending) {
        pending += 1
        continue
      }
      if (
        activeMimes.length > 0 &&
        !activeMimes.includes(effectiveMime(item))
      ) {
        continue
      }
      if (!matchesDimFilter(item, dimFilter)) continue
      // Unretained outputs are summarised in one notice, not shown as cards.
      if (item.lostReason !== undefined) {
        lost += 1
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
      visibleLostCount: lost,
    }
  }, [items, blockSkeletons, activeMimes, dimFilter, effectiveMime, status])

  const groups = useMemo(
    () => groupOutputs(visibleItems, groupBy, effectiveMime),
    [visibleItems, groupBy, effectiveMime],
  )

  /** Viewer order follows the rendered sections. */
  const { navItems, sectionOf } = useMemo(() => {
    if (!groups) return { navItems: visibleItems, sectionOf: segmentKey }
    const sections = new Map<string, string>()
    const ordered: Array<OutputItem> = []
    for (const group of groups) {
      for (const section of group.children ?? [group]) {
        for (const item of section.items) {
          sections.set(item.taskId, `${group.key}\n${section.key}`)
          ordered.push(item)
        }
      }
    }
    return {
      navItems: ordered,
      sectionOf: (item: OutputItem) => sections.get(item.taskId) ?? '',
    }
  }, [groups, visibleItems])

  const isRunning = !isTerminalStatus(status)
  const failed = status === 'failed'

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
  /** Distinct lost-output reasons; hook stays above the early return. */
  const lostReasons = useMemo(
    () => Array.from(new Set(Object.values(lostTaskIds))),
    [lostTaskIds],
  )

  if (items.length === 0 && blockSkeletons.length === 0) {
    // GRIB-only run — the Stored outputs card covers it; render nothing.
    if (hasStoredOutputs) return null
    return (
      <Card className="gap-0 overflow-hidden border-0 bg-transparent bg-none py-0">
        <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <P className="font-medium text-muted-foreground">
            {t(failed ? 'outputs.failedNoOutputs' : 'outputs.noOutputs')}
          </P>
          {isRunning && (
            <P className="text-muted-foreground">
              {t('outputs.noOutputsRunning')}
            </P>
          )}
          {failed && onViewLogs && (
            <Button variant="outline" size="sm" onClick={onViewLogs}>
              {t('outputs.viewLogs')}
            </Button>
          )}
        </div>
      </Card>
    )
  }

  // Stored markers count only while unfiltered.
  const filtered = activeMimes.length > 0 || Object.keys(dimFilter).length > 0
  const stored = filtered ? { available: 0, pending: 0, lost: 0 } : storedStats
  const shownAvailable = visibleAvailableCount + stored.available
  const totalAvailable = availableCount + stored.available
  const shownPending = visiblePendingCount + stored.pending
  const shownLost = visibleLostCount + stored.lost
  const toolbar = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      {/* Min width keeps the toolbar wrap stable. */}
      <P className="min-w-64 text-muted-foreground">
        {t('outputs.generated')}: {shownAvailable}
        {shownAvailable !== totalAvailable && ` / ${totalAvailable}`}
        {shownPending > 0 && (
          <span className="ml-2">
            · {t(failed ? 'outputs.notProduced' : 'outputs.pending')}:{' '}
            {shownPending}
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
        {splitDims.map(([key, values]) =>
          key === 'step' && stepLayout ? (
            <StepGridMenu
              key={key}
              name={dimFormat.key(key)}
              grid={stepLayout.grid}
              steps={stepLayout.steps}
              counts={stepStats.counts}
              produced={stepStats.produced}
              selected={'step' in dimFilter ? dimFilter.step.map(Number) : null}
              onChange={(next) =>
                setDimValues('step', next && next.map(String))
              }
            />
          ) : (
            <DimFilterMenu
              key={key}
              name={dimFormat.key(key)}
              values={values}
              selected={dimFilter[key] ?? []}
              shortLabel={(value) => dimFormat.short(key, value)}
              fullLabel={(value) => dimFormat.value(key, value, 'full')}
              onChange={(next) =>
                setDimValues(key, next.length > 0 ? next : null)
              }
            />
          ),
        )}
        {groupByOptions.length > 1 && (
          <GroupBySelect
            value={groupBy}
            options={groupByOptions}
            format={dimFormat}
            onChange={setGroupBy}
          />
        )}
      </div>
    </div>
  )

  return (
    <Card
      // overflow-visible: the Card base would clip the first row's outer corners.
      className="gap-0 overflow-visible border-0 bg-transparent bg-none py-0"
    >
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}
      {/* No top padding — the parent's space-y-4 sets the gap above the grid. */}
      <div className="space-y-3 pb-3">
        {!toolbarSlot && toolbar}

        {shownLost > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>{t('outputs.lostNotice', { count: shownLost })}</span>
            {lostReasons.length > 0 && (
              <span className="italic">— {lostReasons.join(' · ')}</span>
            )}
          </div>
        )}

        {visibleItems.length === 0 ? (
          shownLost > 0 && shownPending === 0 ? null : failed &&
            shownPending > 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground" />
              <P className="font-medium text-muted-foreground">
                {t('outputs.failedNoOutputs')}
              </P>
              <P className="text-muted-foreground">
                {t('outputs.failedExpected', { count: shownPending })}
              </P>
              {onViewLogs && (
                <Button variant="outline" size="sm" onClick={onViewLogs}>
                  {t('outputs.viewLogs')}
                </Button>
              )}
            </div>
          ) : // A `?mimes=` filter from the URL can match nothing until opaque
          // items finish sniffing; show skeletons for those rather than a
          // "no match" that a moment later turns out wrong.
          pendingSniffItems.length > 0 ? (
            <div className={GRID_CLASS}>
              {pendingSniffItems.map((item) => (
                <SkeletonOutputCard
                  key={item.taskId}
                  label={outputTitle(item)}
                />
              ))}
            </div>
          ) : (
            <P className="px-1 py-6 text-center text-sm text-muted-foreground">
              {t('outputs.noMatch')}
            </P>
          )
        ) : (
          <>
            <GroupedGrid
              groupBy={groupBy}
              groups={groups}
              items={visibleItems}
              runningBlockSet={runningBlockSet}
              dimFormat={dimFormat}
              effectiveMime={effectiveMime}
              onOpenViewer={(item, adapter) =>
                setActiveViewer({ item, adapter })
              }
            />
            {failed && shownPending > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('outputs.failedNotProduced', { count: shownPending })}
                {onViewLogs && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={onViewLogs}
                  >
                    {t('outputs.viewLogs')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {ActiveViewer && activeViewer && (
        <ActiveViewerHost
          ActiveViewer={ActiveViewer}
          activeViewer={activeViewer}
          navItems={navItems}
          sectionOf={sectionOf}
          dimFormat={dimFormat}
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
  /** Visible outputs in rendered order. */
  navItems: ReadonlyArray<OutputItem>
  sectionOf: (item: OutputItem) => string
  dimFormat: DimFormat
  effectiveMime: (item: OutputItem) => string
  setActiveViewer: (
    next: { item: OutputItem; adapter: OutputAdapter } | null,
  ) => void
}

/** Navigation, hotkeys, playback and filmstrip; mounts only while open. */
function ActiveViewerHost({
  ActiveViewer,
  activeViewer,
  navItems,
  sectionOf,
  dimFormat,
  effectiveMime,
  setActiveViewer,
}: ActiveViewerHostProps) {
  const queryClient = useQueryClient()
  const showFilmstrip = useUiStore((state) => state.outputFilmstrip)
  const setShowFilmstrip = useUiStore((state) => state.setOutputFilmstrip)
  const adapterFor = useCallback(
    (item: OutputItem) => resolveAdapter(effectiveMime(item)),
    [effectiveMime],
  )
  // Pending outputs and ones without a viewer (GRIB) would close it.
  const viewable = useMemo(
    () => navItems.filter((it) => it.isAvailable && adapterFor(it).Viewer),
    [navItems, adapterFor],
  )
  const activeIndex = viewable.findIndex(
    (it) => it.taskId === activeViewer.item.taskId,
  )
  // Latest copy of the opened item.
  const item = activeIndex >= 0 ? viewable[activeIndex] : activeViewer.item
  const prevItem = activeIndex > 0 ? viewable[activeIndex - 1] : null
  const nextItem =
    activeIndex >= 0 && activeIndex < viewable.length - 1
      ? viewable[activeIndex + 1]
      : null

  // Play steps the innermost coordinate, up/down the next.
  const orderedDims = orderDims(item.dims ?? [])
  const fastKey = orderedDims.at(-1)?.[0]
  const slowKey = orderedDims.at(-2)?.[0]
  const upItem = slowKey ? dimNeighbor(viewable, item, slowKey, -1) : null
  const downItem = slowKey ? dimNeighbor(viewable, item, slowKey, 1) : null
  const playNext = fastKey
    ? dimNeighbor(viewable, item, fastKey, 1, true)
    : null
  const [playing, setPlaying] = useState(false)
  const isPlaying = playing && playNext !== null

  // Series along the innermost coordinate.
  const line = fastKey ? dimLine(viewable, item, fastKey) : []
  const series = line.map(([, it]) => it)
  const firstItem = series.length > 1 ? series[0] : null
  const lastItem = series.length > 1 ? (series.at(-1) ?? null) : null
  // Shift+arrows: +-24 h.
  const step = fastKey === 'step' ? Number(dimValue(item, 'step')) : NaN
  const nextDay = line.find(([v]) => Number(v) >= step + 24)?.[1] ?? null
  const prevDay =
    line.filter(([v]) => Number(v) <= step - 24).at(-1)?.[1] ?? null

  const stepTo = useCallback(
    (next: OutputItem) =>
      setActiveViewer({ item: next, adapter: adapterFor(next) }),
    [setActiveViewer, adapterFor],
  )

  const goPrev = useCallback(() => {
    if (prevItem) stepTo(prevItem)
  }, [prevItem, stepTo])
  const goNext = useCallback(() => {
    if (nextItem) stepTo(nextItem)
  }, [nextItem, stepTo])
  const goUp = useCallback(() => {
    if (upItem) stepTo(upItem)
  }, [upItem, stepTo])
  const goDown = useCallback(() => {
    if (downItem) stepTo(downItem)
  }, [downItem, stepTo])
  const togglePlay = useCallback(() => setPlaying((p) => !p), [])
  const goTo = (target: OutputItem | null) => () => {
    if (target && target.taskId !== item.taskId) stepTo(target)
  }

  useEffect(() => {
    if (!isPlaying || !fastKey) return
    // Prefetch the next two frames.
    const after = dimNeighbor(viewable, playNext, fastKey, 1, true)
    for (const frame of [playNext, after]) {
      if (frame) {
        void prefetchJobResultBlob(queryClient, frame.jobId, frame.taskId)
      }
    }
    const timer = window.setTimeout(() => stepTo(playNext), PLAY_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [isPlaying, playNext, fastKey, viewable, queryClient, stepTo])

  // Keep Space from also clicking a focused button.
  const canPlay = playNext !== null
  useEffect(() => {
    if (!canPlay) return
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target instanceof Element) {
        if (e.target.closest('button')) e.preventDefault()
      }
    }
    window.addEventListener('keyup', onKeyUp, true)
    return () => window.removeEventListener('keyup', onKeyUp, true)
  }, [canPlay])

  // Arrow + vi-style output nav (PDF page nav stays on header buttons).
  useHotkey('ArrowLeft', goPrev, { enabled: !!prevItem, ignoreInputs: true })
  useHotkey('K', goPrev, { enabled: !!prevItem, ignoreInputs: true })
  useHotkey('ArrowRight', goNext, { enabled: !!nextItem, ignoreInputs: true })
  useHotkey('J', goNext, { enabled: !!nextItem, ignoreInputs: true })
  useHotkey('ArrowUp', goUp, { enabled: !!upItem, ignoreInputs: true })
  useHotkey('ArrowDown', goDown, { enabled: !!downItem, ignoreInputs: true })
  useHotkey('Space', togglePlay, { enabled: !!playNext, ignoreInputs: true })
  useHotkey('Shift+ArrowLeft', goTo(prevDay), {
    enabled: !!prevDay,
    ignoreInputs: true,
  })
  useHotkey('Shift+ArrowRight', goTo(nextDay), {
    enabled: !!nextDay,
    ignoreInputs: true,
  })
  useHotkey('Home', goTo(firstItem), {
    enabled: !!firstItem,
    ignoreInputs: true,
  })
  useHotkey('End', goTo(lastItem), { enabled: !!lastItem, ignoreInputs: true })
  useHotkey('T', () => setShowFilmstrip(!showFilmstrip), {
    enabled: viewable.length > 1,
    ignoreInputs: true,
  })

  const hasDims = orderedDims.length > 0
  // Split outputs show their series, others all.
  const filmstripItems = series.length > 1 ? series : viewable
  const hasFilmstrip = showFilmstrip && filmstripItems.length > 1

  return (
    <Suspense fallback={null}>
      <ActiveViewer
        // Keyed by type, so the viewer stays up across items.
        key={activeViewer.adapter.id}
        item={item}
        adapter={activeViewer.adapter}
        onClose={() => {
          setActiveViewer(null)
        }}
        onPrev={prevItem ? goPrev : undefined}
        onNext={nextItem ? goNext : undefined}
        navIndex={
          activeIndex >= 0
            ? { current: activeIndex + 1, total: viewable.length }
            : undefined
        }
        footer={
          hasDims || hasFilmstrip ? (
            <>
              {hasDims && (
                <DimNavigator
                  item={item}
                  items={viewable}
                  format={dimFormat}
                  fastKey={fastKey}
                  slowKey={slowKey}
                  playing={isPlaying}
                  canPlay={playNext !== null}
                  onTogglePlay={togglePlay}
                  onSelect={stepTo}
                />
              )}
              {hasFilmstrip && (
                <Filmstrip
                  items={filmstripItems}
                  activeTaskId={item.taskId}
                  adapterFor={adapterFor}
                  onSelect={stepTo}
                  sectionOf={series.length > 1 ? undefined : sectionOf}
                  badgeOf={
                    series.length > 1 && fastKey
                      ? (it) =>
                          dimFormat.value(
                            fastKey,
                            dimValue(it, fastKey) ?? '',
                            'compact',
                          )
                      : undefined
                  }
                />
              )}
            </>
          ) : undefined
        }
      />
    </Suspense>
  )
}

type GroupKind = 'block' | 'mime' | 'dim'

interface OutputGroup {
  kind: GroupKind
  /** Block id, mime, or coordinate value ('' for outputs without one). */
  key: string
  items: ReadonlyArray<OutputItem>
  /** Content-type sections inside a block section. */
  children?: ReadonlyArray<OutputGroup>
}

/** Sections in render order; null renders one flat grid. */
function groupOutputs(
  items: ReadonlyArray<OutputItem>,
  groupBy: GroupBy,
  effectiveMime: (item: OutputItem) => string,
): Array<OutputGroup> | null {
  const byMime = (list: ReadonlyArray<OutputItem>): Array<OutputGroup> =>
    groupByKey(list, effectiveMime).map(([key, mimeItems]) => ({
      kind: 'mime',
      key,
      items: mimeItems,
    }))
  switch (groupBy) {
    case 'none':
      return null
    case 'mime':
      return byMime(items)
    case 'block':
    case 'block-and-mime':
      return groupByKey(items, (i) => i.originalBlock).map(
        ([key, blockItems]) => ({
          kind: 'block',
          key,
          items: blockItems,
          children:
            groupBy === 'block-and-mime' ? byMime(blockItems) : undefined,
        }),
      )
    default: {
      const dim = groupBy.slice(DIM_PREFIX.length)
      return groupByKey(items, (i) => dimValue(i, dim) ?? '')
        .sort(([a], [b]) =>
          a === '' || b === ''
            ? Number(a === '') - Number(b === '')
            : compareDimValues(a, b),
        )
        .map(([key, dimItems]) => ({ kind: 'dim', key, items: dimItems }))
    }
  }
}

interface GroupedGridProps {
  groupBy: GroupBy
  groups: ReadonlyArray<OutputGroup> | null
  items: ReadonlyArray<OutputItem>
  runningBlockSet: ReadonlySet<string>
  dimFormat: DimFormat
  effectiveMime: (item: OutputItem) => string
  onOpenViewer: (item: OutputItem, adapter: OutputAdapter) => void
}

function GroupedGrid({
  groupBy,
  groups,
  items,
  runningBlockSet,
  dimFormat,
  effectiveMime,
  onOpenViewer,
}: GroupedGridProps) {
  const { t } = useTranslation('executions')
  const grid = (gridItems: ReadonlyArray<OutputItem>) => (
    <FlexGrid
      items={gridItems}
      runningBlockSet={runningBlockSet}
      effectiveMime={effectiveMime}
      onOpenViewer={onOpenViewer}
    />
  )
  if (!groups) return grid(items)

  const title = (group: OutputGroup): React.ReactNode => {
    switch (group.kind) {
      case 'block': {
        const { blockName, settings } = group.items[0]
        if (!settings?.length) return blockName
        return (
          <>
            {blockName}
            <span className="font-normal text-muted-foreground">
              {' · '}
              {dimFormat.dims(settings, 'full')}
            </span>
          </>
        )
      }
      case 'mime':
        return <MimeSectionLabel mime={group.key} />
      case 'dim':
        return group.key === ''
          ? t('outputs.sections.otherOutputs')
          : dimFormat.value(groupBy.slice(DIM_PREFIX.length), group.key, 'full')
    }
  }

  return (
    <div className={groupBy === 'block-and-mime' ? 'space-y-6' : 'space-y-5'}>
      {groups.map((group) => (
        <Section
          key={group.key}
          title={title(group)}
          count={group.items.length}
          blockId={group.kind === 'block' ? group.key : undefined}
        >
          {group.children ? (
            <div className="space-y-4">
              {group.children.map((child) => (
                <Subsection
                  key={child.key}
                  title={title(child)}
                  count={child.items.length}
                >
                  {grid(child.items)}
                </Subsection>
              ))}
            </div>
          ) : (
            grid(group.items)
          )}
        </Section>
      ))}
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
        <SkeletonOutputCard label={outputTitle(item)} isRunning={isRunning} />
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
  options,
  format,
  onChange,
}: {
  value: GroupBy
  options: ReadonlyArray<GroupBy>
  format: DimFormat
  onChange: (next: GroupBy) => void
}) {
  const { t } = useTranslation('executions')
  const label = (option: GroupBy): string =>
    isStaticGroupBy(option)
      ? t(groupByI18nKey(option))
      : format.key(option.slice(DIM_PREFIX.length))
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {t('outputs.groupBy.label')}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as GroupBy)}>
        <SelectTrigger className="h-8 w-44 text-sm">
          <SelectValue>{label(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {label(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function isStaticGroupBy(
  option: GroupBy,
): option is (typeof GROUP_BY_OPTIONS)[number] {
  return (GROUP_BY_OPTIONS as ReadonlyArray<string>).includes(option)
}

function groupByI18nKey(
  option: (typeof GROUP_BY_OPTIONS)[number],
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

/** Sort key for same-type blocks. */
function settingValues(item: OutputItem): string {
  return (item.settings ?? []).map(([, value]) => value).join('\n')
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
