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
 * /visualise — geo visualisation of collected sources; single-source by
 * default, comparison once a second source is active.
 *
 * The basket (persisted, see comparisonStore) holds up to 8 sources; up
 * to two are active as slots A and B, pinned in the URL (`?a=…&b=…`,
 * `b=off` = deliberate single view) so a view is shareable. Active
 * sources resolve to lenses automatically (useComparisonSource); lenses
 * are never stopped implicitly — the header offers an explicit stop that
 * also pauses auto-start.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { BrushCleaning, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRouteApi } from '@tanstack/react-router'
import {
  SLOT_B_OFF,
  entryDisplayName,
  entryRef,
  redactWmsUrl,
} from '../entry-ref'
import { useComparisonStore } from '../stores/comparisonStore'
import { useComparisonSource } from '../hooks/useComparisonSource'
import { useStopOrphanedLenses } from '../hooks/useStopOrphanedLenses'
import { useHydrateComparisonFromUrl } from '../hooks/useHydrateComparisonFromUrl'
import { useEnrichComparisonEntry } from '../hooks/useEnrichComparisonEntry'

import { CompareSlotBar } from './CompareSlotBar'
import { ComparePanel } from './ComparePanel'
import { SourcePicker } from './SourcePicker'
import { VisualiseHub } from './VisualiseHub'
import type { ComparisonEntry } from '../entry-ref'
import type { ComparisonSourceState } from '../hooks/useComparisonSource'
import type { CompareMode } from '@/features/viewer/geo/types'
import { useViewportFill } from '@/hooks/useViewportFill'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { H1, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// A factory, not a module-level lazy: a rejected import stays rejected
// inside React.lazy, so the boundary's Retry mints a fresh one.
const makeGeoViewer = () =>
  lazy(() =>
    import('@/features/viewer/geo/GeoViewer').then((m) => ({
      default: m.GeoViewer,
    })),
  )

const route = getRouteApi('/_authenticated/visualise')

export interface ActivePair {
  a: ComparisonEntry | null
  b: ComparisonEntry | null
}

/** Resolve + normalize the active pair from URL refs and the basket. */
function useActivePair(): ActivePair & {
  assignSlot: (slot: 'a' | 'b', ref: string) => void
  swapSlots: () => void
  clearSlotB: () => void
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
  // the pair is always pinned in the URL). `b=off` is a deliberate single
  // view — never re-fill it. Unresolved refs belong to
  // useHydrateComparisonFromUrl (add/strip/rewrite) — wait, or filling the
  // sibling slot races that update. `replace` keeps history clean while
  // chips are clicked around.
  useEffect(() => {
    if (entries.length === 0) return
    const refs = entries.map((e) => entryRef(e))
    const aMissing = search.a === undefined || search.a === SLOT_B_OFF
    const bMissing = search.b === undefined
    if (!aMissing && !bMissing) return
    const aUnresolved = !aMissing && !byRef.has(search.a!)
    const bUnresolved =
      !bMissing && search.b !== SLOT_B_OFF && !byRef.has(search.b!)
    if (aUnresolved || bUnresolved) return
    const nextA = aMissing ? refs.find((r) => r !== search.b) : search.a
    const nextB = bMissing ? refs.find((r) => r !== nextA) : search.b
    if (nextA !== search.a || nextB !== search.b) {
      void navigate({
        search: (prev) => ({ ...prev, a: nextA, b: nextB }),
        replace: true,
      })
    }
  }, [entries, byRef, search.a, search.b, navigate])

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
    if (search.b === SLOT_B_OFF) return
    void navigate({
      search: (prev) => ({ ...prev, a: prev.b, b: prev.a }),
      replace: true,
    })
  }
  const clearSlotB = () => {
    void navigate({
      search: (prev) => ({ ...prev, b: SLOT_B_OFF }),
      replace: true,
    })
  }

  return {
    a: aValid ? (byRef.get(search.a!) ?? null) : null,
    b: bValid ? (byRef.get(search.b!) ?? null) : null,
    assignSlot,
    swapSlots,
    clearSlotB,
  }
}

export function VisualisePage() {
  const { t } = useTranslation(['visualise', 'common'])
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const entries = useComparisonStore((s) => s.entries)
  const clear = useComparisonStore((s) => s.clear)
  const { a, b, assignSlot, swapSlots, clearSlotB } = useActivePair()
  const { pendingUnverified, resolveUnverified } = useHydrateComparisonFromUrl()

  // Clearing the basket must clear the URL pair too — hydration would
  // otherwise resurrect the active refs as stub entries.
  const stopOrphanedLenses = useStopOrphanedLenses()
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const clearAll = () => {
    const removed = entries
    clear()
    void stopOrphanedLenses(removed, [])
    void navigate({
      search: (prev) => ({ ...prev, a: undefined, b: undefined }),
      replace: true,
    })
  }

  const mode: CompareMode = search.mode ?? 'side'
  const onModeChange = (next: CompareMode) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        // Omit the default so a bare /compare?a=…&b=… stays clean.
        mode: next === 'side' ? undefined : next,
      }),
      replace: true,
    })
  }

  const [pickerOpen, setPickerOpen] = useState(false)
  const [GeoViewer, setGeoViewer] = useState(() => makeGeoViewer())
  const stateA = useComparisonSource(a, { autoStart: true })
  const stateB = useComparisonSource(b, { autoStart: true })
  const viewerFill = useViewportFill(
    entries.length > 0 && a !== null && stateA.phase === 'running',
  )

  return (
    // Slim constant gutter — a map workspace uses the width it can get.
    <ListPageContainer className="space-y-4 px-4 py-4 sm:px-4 lg:px-4">
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
          // Phones: full-width below title+actions, not wedged beside them.
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 max-sm:order-last max-sm:basis-full">
            <CompareSlotBar
              entries={entries}
              aRef={a ? entryRef(a) : undefined}
              bRef={b ? entryRef(b) : undefined}
              onAssign={assignSlot}
              onSwap={swapSlots}
              onSingleView={clearSlotB}
            />
            {/* B lifecycle while the solo viewer keeps working. */}
            {b !== null && a !== null && stateA.phase === 'running' && (
              <SlotBStatusChip state={stateB} />
            )}
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
              {entries.length > 0
                ? t('basket.manageSources')
                : t('basket.addSource')}
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>
                  {entries.length > 0
                    ? t('basket.manageSources')
                    : t('picker.title')}
                </DialogTitle>
                <DialogDescription>{t('page.description')}</DialogDescription>
              </DialogHeader>
              <SourcePicker />
            </DialogContent>
          </Dialog>
          {entries.length > 0 && (
            <AlertDialog
              open={clearConfirmOpen}
              onOpenChange={setClearConfirmOpen}
            >
              <AlertDialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title={t('basket.clear')}
                    aria-label={t('basket.clear')}
                  />
                }
              >
                <BrushCleaning className="h-3.5 w-3.5" />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('basket.clearConfirmTitle')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('basket.clearConfirmBody', { count: entries.length })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      clearAll()
                      setClearConfirmOpen(false)
                    }}
                  >
                    {t('basket.clear')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Link-borne sources need explicit consent; any close declines. */}
      <AlertDialog
        open={pendingUnverified.length > 0}
        onOpenChange={(open) => {
          if (!open) resolveUnverified('ignore')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('hydrate.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('hydrate.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1">
            {pendingUnverified.map((p) => {
              const detail = p.kind === 'wms' ? redactWmsUrl(p.url) : p.path
              return (
                <li
                  key={p.ref}
                  title={detail}
                  className="flex min-w-0 items-baseline gap-2"
                >
                  <span className="rounded border border-border px-1 font-mono text-[10px] tracking-wide text-muted-foreground">
                    {t(p.kind === 'wms' ? 'basket.kindWms' : 'basket.kindPath')}
                  </span>
                  <span className="truncate font-mono text-xs">{detail}</span>
                </li>
              )
            })}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('hydrate.ignore')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveUnverified('add')}>
              {t('hydrate.add')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {entries.length === 0 ? (
        <VisualiseHub />
      ) : a && stateA.phase === 'running' ? (
        // Viewer bottom meets the viewport bottom; footer below the fold.
        <div
          ref={viewerFill.ref}
          style={
            viewerFill.height !== null
              ? { height: viewerFill.height }
              : undefined
          }
          className="h-[75vh] min-h-[480px]"
        >
          {/* Local boundary: a failed viewer chunk (redeploy) or an
              OL/canvas throw must not take down the page shell. */}
          <ErrorBoundary
            onReset={() => setGeoViewer(() => makeGeoViewer())}
            fallbackRender={({ error, resetErrorBoundary }) => (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <P className="font-medium">{t('viewerError.title')}</P>
                <P
                  title={error.message}
                  className="max-w-lg truncate font-mono text-xs text-muted-foreground"
                >
                  {error.message}
                </P>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={resetErrorBoundary}
                  >
                    {t('viewerError.retry')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.location.reload()}
                  >
                    {t('viewerError.reload')}
                  </Button>
                </div>
              </div>
            )}
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              }
            >
              {/* Single JSX position — b flips null↔value without a
                  remount, so camera/selection/time survive the switch. */}
              <GeoViewer
                a={{ baseUrl: stateA.baseUrl, label: entryDisplayName(a) }}
                b={
                  b && stateB.phase === 'running'
                    ? { baseUrl: stateB.baseUrl, label: entryDisplayName(b) }
                    : null
                }
                mode={mode}
                onModeChange={onModeChange}
                onRemoveB={clearSlotB}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        // A not running yet — lifecycle panels.
        <div className="grid gap-3 lg:grid-cols-2">
          <ComparePanel slot="A" entry={a} state={stateA} />
          {b !== null && <ComparePanel slot="B" entry={b} state={stateB} />}
        </div>
      )}
    </ListPageContainer>
  )
}

/** Compact B lifecycle indicator shown while the viewer runs solo. */
function SlotBStatusChip({ state }: { state: ComparisonSourceState }) {
  const { t } = useTranslation('visualise')
  if (state.phase === 'running' || state.phase === 'idle') return null
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex h-4 w-4 items-center justify-center rounded bg-orange-600 font-mono text-[10px] font-bold text-white dark:bg-orange-500">
        B
      </span>
      {state.phase === 'failed' || state.phase === 'dirError' ? (
        <>
          <span className="max-w-64 truncate text-destructive">
            {('error' in state && state.error) || t('lens.failed')}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={state.retry}
          >
            {t('lens.retry')}
          </Button>
        </>
      ) : state.phase === 'stopped' ? (
        <>
          {t('lens.paused')}
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={state.start}
          >
            {t('lens.start')}
          </Button>
        </>
      ) : (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('lens.starting')}
        </>
      )}
    </span>
  )
}

/** Null-rendering mount point for per-entry metadata enrichment. */
function EnrichmentMount({ entry }: { entry: ComparisonEntry }) {
  useEnrichComparisonEntry(entry)
  return null
}
