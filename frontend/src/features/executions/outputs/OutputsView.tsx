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
 * Coordinator for the outputs panel. Renders a flat flex-wrap grid of
 * cards, exposes MIME filter chips + a sort dropdown, and lazy-mounts
 * the active item's viewer.
 *
 * Sniffer-resolved mimes are lifted up here via `onResolved` so the chip
 * row reflects the actual format (PNG/SVG/PDF) rather than the wire mime
 * (typically `application/octet-stream` until backend ships proper
 * RawOutput.mime_type).
 */

import { Package } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { registerFirstPartyAdapters } from './adapters'
import { MimeFilterChips } from './MimeFilterChips'
import { OutputCard } from './OutputCard'
import { useResolvedAdapter } from './useResolvedAdapter'
import type { JobStatus, RunOutputs } from '@/api/types/job.types'
import type { OutputAdapter, OutputItem } from './types'
import { P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { isTerminalStatus } from '@/api/types/job.types'

// Side-effect: adapter registration runs at module load. Idempotent.
registerFirstPartyAdapters()

interface OutputsViewProps {
  jobId: string
  status: JobStatus
  outputs: RunOutputs | null
  /** Optional DOM node to portal the toolbar (count + filter chips) into.
   * When omitted, the toolbar renders inline above the grid. */
  toolbarSlot?: HTMLElement | null
}

export function OutputsView({
  jobId,
  status,
  outputs,
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

  const items = useMemo<Array<OutputItem>>(() => {
    if (!outputs) return []
    return Object.entries(outputs).map(([taskId, meta]) => ({
      jobId,
      taskId,
      mimeType: meta.mime_type,
      originalBlock: meta.original_block,
      isAvailable: meta.is_available,
    }))
  }, [jobId, outputs])

  const availableItems = useMemo(
    () => items.filter((i) => i.isAvailable),
    [items],
  )

  /** Effective mime per item: sniffer-promoted if available, else the wire
   * mime. This is what filter chips, dispatch and counts all use. */
  const effectiveMime = useCallback(
    (item: OutputItem): string => resolvedMimes[item.taskId] ?? item.mimeType,
    [resolvedMimes],
  )

  const { distinctMimes, mimeCounts } = useMemo(() => {
    const counts: Record<string, number> = {}
    const order: Array<string> = []
    for (const item of availableItems) {
      const mime = effectiveMime(item)
      if (!(mime in counts)) {
        order.push(mime)
        counts[mime] = 0
      }
      counts[mime] = (counts[mime] ?? 0) + 1
    }
    return { distinctMimes: order, mimeCounts: counts }
  }, [availableItems, effectiveMime])

  const activeMimes = useMemo(() => parseMimes(search.mimes), [search.mimes])

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

  const filteredItems = useMemo(() => {
    if (activeMimes.length === 0) return availableItems
    return availableItems.filter((i) => activeMimes.includes(effectiveMime(i)))
  }, [availableItems, activeMimes, effectiveMime])

  const isRunning = !isTerminalStatus(status)
  const ActiveViewer = activeViewer?.adapter.Viewer ?? null

  if (availableItems.length === 0) {
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
        {t('outputs.generated')}: {filteredItems.length}
        {filteredItems.length !== availableItems.length &&
          ` / ${availableItems.length}`}
      </P>
      {distinctMimes.length > 1 && (
        <MimeFilterChips
          availableMimes={distinctMimes}
          activeMimes={activeMimes}
          counts={mimeCounts}
          total={availableItems.length}
          onChange={setActiveMimes}
        />
      )}
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

        {filteredItems.length === 0 ? (
          <P className="px-1 py-6 text-center text-sm text-muted-foreground">
            {t('outputs.noMatch')}
          </P>
        ) : (
          <div className="flex flex-wrap gap-3">
            {filteredItems.map((item) => (
              <div key={item.taskId} className="w-60 shrink-0">
                <OutputCardSlot
                  item={item}
                  onOpenViewer={(i, adapter) =>
                    setActiveViewer({ item: i, adapter })
                  }
                  onResolved={handleResolved}
                />
              </div>
            ))}
          </div>
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
