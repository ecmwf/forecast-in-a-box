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
 * /compare — geographic comparison of collected sources.
 *
 * The basket (persisted, see comparisonStore) holds up to 8 sources; two
 * are active at a time as slots A and B, pinned in the URL (`?a=…&b=…`)
 * so a comparison is shareable. Clicking a basket chip activates it as
 * source B (clicking the current A swaps the pair) — the fastest gesture
 * for "compare everything against a reference A". Active sources resolve
 * to lenses automatically (useComparisonSource); lenses are never stopped
 * implicitly — the header offers an explicit stop that also pauses
 * auto-start.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Square, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRouteApi } from '@tanstack/react-router'
import { entryDisplayName, entryRef } from '../entry-ref'
import { useComparisonStore } from '../stores/comparisonStore'
import { useComparisonSource } from '../hooks/useComparisonSource'
import { useHydrateComparisonFromUrl } from '../hooks/useHydrateComparisonFromUrl'
import { useEnrichComparisonEntry } from '../hooks/useEnrichComparisonEntry'
import { CompareSlotBar } from './CompareSlotBar'
import { ComparePanel } from './ComparePanel'
import { ComparisonSourcePicker } from './ComparisonSourcePicker'
import type { ComparisonEntry } from '../entry-ref'
import type { CompareMode } from '@/features/viewer/compare/types'
import { useStopLens } from '@/api/hooks/useLens'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { H1, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { showToast } from '@/lib/toast'

const CompareViewer = lazy(() =>
  import('@/features/viewer/compare/CompareViewer').then((m) => ({
    default: m.CompareViewer,
  })),
)

const route = getRouteApi('/_authenticated/compare')

export interface ActivePair {
  a: ComparisonEntry | null
  b: ComparisonEntry | null
}

/** Resolve + normalize the active pair from URL refs and the basket. */
function useActivePair(): ActivePair & {
  assignSlot: (slot: 'a' | 'b', ref: string) => void
  swapSlots: () => void
} {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const entries = useComparisonStore((s) => s.entries)

  const byRef = useMemo(
    () => new Map(entries.map((e) => [entryRef(e), e])),
    [entries],
  )
  const aValid = search.a !== undefined && byRef.has(search.a)
  const bValid = search.b !== undefined && byRef.has(search.b)

  // Materialize missing slots from basket order (route file explains why
  // the pair is always pinned in the URL). Unknown refs are left in place
  // — useHydrateComparisonFromUrl owns them (adds or strips). `replace`
  // keeps history clean while chips are clicked around.
  useEffect(() => {
    if (entries.length === 0) return
    const refs = entries.map((e) => entryRef(e))
    const aMissing = search.a === undefined
    const bMissing = search.b === undefined
    if (!aMissing && !bMissing) return
    const nextA = aMissing ? refs.find((r) => r !== search.b) : search.a
    const nextB = bMissing ? refs.find((r) => r !== nextA) : search.b
    if (nextA !== search.a || nextB !== search.b) {
      void navigate({
        search: (prev) => ({ ...prev, a: nextA, b: nextB }),
        replace: true,
      })
    }
  }, [entries, search.a, search.b, navigate])

  // Plain assignment — the same source in both slots is a real workflow
  // (unlink layers, compare two parameters of one run; or pair with the
  // offset/independent time-link to compare two instants). Swapping is
  // the dedicated ⇄ button's job.
  const assignSlot = (slot: 'a' | 'b', ref: string) => {
    void navigate({
      search: (prev) => ({ ...prev, [slot]: ref }),
      replace: true,
    })
  }
  const swapSlots = () => {
    void navigate({
      search: (prev) => ({ ...prev, a: prev.b, b: prev.a }),
      replace: true,
    })
  }

  return {
    a: aValid ? (byRef.get(search.a!) ?? null) : null,
    b: bValid ? (byRef.get(search.b!) ?? null) : null,
    assignSlot,
    swapSlots,
  }
}

export function ComparePage() {
  const { t } = useTranslation('compare')
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const entries = useComparisonStore((s) => s.entries)
  const clear = useComparisonStore((s) => s.clear)
  const { a, b, assignSlot, swapSlots } = useActivePair()
  useHydrateComparisonFromUrl()

  const mode: CompareMode = search.mode ?? 'swipe'
  const onModeChange = (next: CompareMode) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        // Omit the default so a bare /compare?a=…&b=… stays clean.
        mode: next === 'swipe' ? undefined : next,
      }),
      replace: true,
    })
  }

  const [pickerOpen, setPickerOpen] = useState(false)
  // "Stop lens servers" pauses auto-start so panels don't instantly
  // restart what the user just stopped; per-panel Start clears it.
  const [lensesPaused, setLensesPaused] = useState(false)
  const stateA = useComparisonSource(a, { autoStart: !lensesPaused })
  const stateB = useComparisonSource(b, { autoStart: !lensesPaused })

  const stopMutation = useStopLens()
  const activeLensIds = [stateA, stateB].flatMap((s) =>
    s.phase === 'running' && s.lensId ? [s.lensId] : [],
  )
  const stopLenses = () => {
    setLensesPaused(true)
    for (const lensInstanceId of new Set(activeLensIds)) {
      stopMutation.mutate(
        { lensInstanceId },
        { onError: (err) => showToast.error(err.message) },
      )
    }
    showToast.info(t('lens.stopped'))
  }

  return (
    <ListPageContainer className="space-y-4">
      {/* Stub entries (hydrated links, lens rows) upgrade their display
          metadata here — chips used to host this, but they now live in
          the manage dialog and may never mount. */}
      {entries.map((entry) => (
        <EnrichmentMount key={entryRef(entry)} entry={entry} />
      ))}

      {/* One compact header row: title · A⇄B slot pickers · actions. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <H1 className="text-xl">{t('page.title')}</H1>
        {entries.length > 0 && (
          <div className="min-w-0 flex-1">
            <CompareSlotBar
              entries={entries}
              aRef={a ? entryRef(a) : undefined}
              bRef={b ? entryRef(b) : undefined}
              onAssign={assignSlot}
              onSwap={swapSlots}
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" className="gap-1.5" />
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t('basket.addSource')}
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{t('picker.title')}</DialogTitle>
                <DialogDescription>{t('page.description')}</DialogDescription>
              </DialogHeader>
              <ComparisonSourcePicker />
            </DialogContent>
          </Dialog>
          {activeLensIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={stopLenses}
              className="gap-1.5"
              title={t('lens.stopAllHint')}
            >
              <Square className="h-3.5 w-3.5" />
              {t('lens.stopAll')}
            </Button>
          )}
          {entries.length > 0 && (
            <Button
              variant="outline"
              size="icon"
              onClick={clear}
              className="h-8 w-8"
              title={t('basket.clear')}
              aria-label={t('basket.clear')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mx-auto w-full max-w-xl rounded-lg border border-border bg-card p-5">
          <ComparisonSourcePicker />
        </div>
      ) : a && b && stateA.phase === 'running' && stateB.phase === 'running' ? (
        <div className="h-[75vh] min-h-[560px]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            }
          >
            <CompareViewer
              a={{ baseUrl: stateA.baseUrl, label: entryDisplayName(a) }}
              b={{ baseUrl: stateB.baseUrl, label: entryDisplayName(b) }}
              mode={mode}
              onModeChange={onModeChange}
            />
          </Suspense>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <ComparePanel slot="A" entry={a} state={stateA} />
          {a !== null && b === null ? (
            <EmptySlotGuidance
              onAdd={() => setPickerOpen(true)}
              onSelf={() => assignSlot('b', entryRef(a))}
            />
          ) : (
            <ComparePanel slot="B" entry={b} state={stateB} />
          )}
        </div>
      )}
    </ListPageContainer>
  )
}

/** Null-rendering mount point for per-entry metadata enrichment. */
function EnrichmentMount({ entry }: { entry: ComparisonEntry }) {
  useEnrichComparisonEntry(entry)
  return null
}

/**
 * First-source guidance: with A filled and B empty (the state right
 * after 'Compare' on a stored output), spell out the two next moves —
 * add a second source, or compare the source with itself to inspect
 * two time steps of one forecast.
 */
function EmptySlotGuidance({
  onAdd,
  onSelf,
}: {
  onAdd: () => void
  onSelf: () => void
}) {
  const { t } = useTranslation('compare')
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-6 text-center">
      <P className="text-sm font-medium">{t('emptyB.title')}</P>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={onAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t('emptyB.add')}
        </Button>
        <Button size="sm" variant="outline" onClick={onSelf}>
          {t('emptyB.self')}
        </Button>
      </div>
      <P className="max-w-md text-xs text-muted-foreground">
        {t('emptyB.selfHint')}
      </P>
    </div>
  )
}
