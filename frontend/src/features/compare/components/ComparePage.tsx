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
 * for "compare everything against a reference A".
 */

import { useEffect, useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getRouteApi } from '@tanstack/react-router'
import { entryDisplayName, entryRef } from '../entry-ref'
import { useComparisonStore } from '../stores/comparisonStore'
import { CompareBasketChip } from './CompareBasketChip'
import type { ComparisonEntry } from '../entry-ref'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'

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

  // Materialize missing/stale slots from basket order (route file explains
  // why the pair is always pinned in the URL). `replace` keeps history
  // clean while chips are clicked around.
  useEffect(() => {
    if (entries.length === 0) {
      if (search.a !== undefined || search.b !== undefined) {
        void navigate({
          search: (prev) => ({ ...prev, a: undefined, b: undefined }),
          replace: true,
        })
      }
      return
    }
    const refs = entries.map((e) => entryRef(e))
    const nextA = aValid ? search.a : refs.find((r) => r !== search.b)
    const nextB = bValid
      ? search.b
      : (refs.find((r) => r !== nextA && r !== search.b) ??
        refs.find((r) => r !== nextA))
    if (nextA !== search.a || nextB !== search.b) {
      void navigate({
        search: (prev) => ({ ...prev, a: nextA, b: nextB }),
        replace: true,
      })
    }
  }, [entries, aValid, bValid, search.a, search.b, navigate])

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
  const entries = useComparisonStore((s) => s.entries)
  const removeEntry = useComparisonStore((s) => s.removeEntry)
  const clear = useComparisonStore((s) => s.clear)
  const { a, b, activateAsB } = useActivePair()

  return (
    <ListPageContainer>
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
        actions={
          entries.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clear}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('basket.clear')}
            </Button>
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

      <CompareContent a={a} b={b} entriesCount={entries.length} />
    </ListPageContainer>
  )
}

/**
 * Placeholder content — replaced by the source-orchestrated panels in the
 * next implementation phase (see GEO_COMPARISON_PLAN.md).
 */
function CompareContent({
  a,
  b,
  entriesCount,
}: ActivePair & { entriesCount: number }) {
  const { t } = useTranslation('compare')
  if (entriesCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {t('picker.empty')}
      </div>
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { slot: 'A', entry: a },
        { slot: 'B', entry: b },
      ].map(({ slot, entry }) => (
        <div
          key={slot}
          className="flex min-h-48 items-center justify-center rounded-lg border border-border bg-card p-6 text-sm"
        >
          {entry ? (
            <span className="font-medium">
              {t('panel.slotLabel', {
                slot,
                name: entryDisplayName(entry),
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t('panel.emptySlot')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
