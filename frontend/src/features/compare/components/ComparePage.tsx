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
import { CompareBasketChip } from './CompareBasketChip'
import { ComparePanel } from './ComparePanel'
import { ComparisonSourcePicker } from './ComparisonSourcePicker'
import type { ComparisonEntry } from '../entry-ref'
import type { CompareMode } from '@/features/viewer/compare/types'
import { useStopLens } from '@/api/hooks/useLens'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { PageHeader } from '@/components/common/PageHeader'
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
  activateAsB: (ref: string) => void
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

  const activateAsB = (ref: string) => {
    void navigate({
      search: (prev) =>
        prev.a === ref
          ? { ...prev, a: prev.b, b: ref }
          : prev.b === ref
            ? prev
            : { ...prev, b: ref },
      replace: true,
    })
  }

  return {
    a: aValid ? (byRef.get(search.a!) ?? null) : null,
    b: bValid ? (byRef.get(search.b!) ?? null) : null,
    activateAsB,
  }
}

export function ComparePage() {
  const { t } = useTranslation('compare')
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const entries = useComparisonStore((s) => s.entries)
  const removeEntry = useComparisonStore((s) => s.removeEntry)
  const clear = useComparisonStore((s) => s.clear)
  const { a, b, activateAsB } = useActivePair()
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
    <ListPageContainer className="space-y-5">
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
        actions={
          entries.length > 0 ? (
            <>
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
                    <DialogDescription>
                      {t('page.description')}
                    </DialogDescription>
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
              <Button
                variant="outline"
                size="sm"
                onClick={clear}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('basket.clear')}
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Basket strip */}
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {entries.map((entry) => {
            const ref = entryRef(entry)
            return (
              <CompareBasketChip
                key={ref}
                entry={entry}
                slot={
                  a && entryRef(a) === ref
                    ? 'A'
                    : b && entryRef(b) === ref
                      ? 'B'
                      : null
                }
                onActivate={() => activateAsB(ref)}
                onRemove={() => removeEntry(ref)}
              />
            )
          })}
        </div>
      )}

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
          <ComparePanel slot="B" entry={b} state={stateB} />
        </div>
      )}
    </ListPageContainer>
  )
}
