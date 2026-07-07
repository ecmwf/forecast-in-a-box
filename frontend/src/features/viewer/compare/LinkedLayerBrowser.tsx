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
 * Layer browser for the compare viewer's right sidebar.
 *
 * Linked mode: one searchable list of PAIRED layers — a row activates the
 * parameter on every source that has it, availability chips (A/B) show
 * gaps, active rows expose an opacity slider. Unlinked mode: the same row
 * UI, but one section per source over that source's own layers.
 */

import { useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber } from '../format'
import { rebaseLensUrl } from '../wms-capabilities'
import { LegendImage } from '../components/LegendImage'
import type { PairedLayer, SourceSlot } from './layer-pairing'
import type { CompareSelection } from './useCompareSelection'
import type { LensSource } from '../hooks/useLensSource'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

const SLOT_CHIP_CLASS: Record<SourceSlot, string> = {
  a: 'bg-blue-600/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  b: 'bg-orange-600/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}

export function LinkedLayerBrowser({
  pairs,
  selection,
  sourceA,
  sourceB,
  baseUrlA,
  baseUrlB,
}: {
  pairs: ReadonlyArray<PairedLayer>
  selection: CompareSelection
  sourceA: LensSource
  sourceB: LensSource
  baseUrlA: string
  baseUrlB: string
}) {
  const { t } = useTranslation('compare')
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()

  const filteredPairs = useMemo(
    () =>
      pairs.filter((pair) => {
        if (!query) return true
        return (
          pair.title.toLowerCase().includes(query) ||
          (pair.subtitle?.toLowerCase().includes(query) ?? false) ||
          Object.values(pair.perSource).some((l) =>
            l.name.toLowerCase().includes(query),
          )
        )
      }),
    [pairs, query],
  )

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="border-b border-border bg-muted/40 px-3 pt-2.5 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('picker.searchPlaceholder')}
            className="h-8 pl-7 text-sm"
          />
        </div>
        {selection.autoUnlinked && (
          <P className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {t('link.autoUnlinked')}
          </P>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
        {selection.linkMode === 'linked' ? (
          <ul className="space-y-1">
            {filteredPairs.map((pair) => (
              <PairRow
                key={pair.key}
                pair={pair}
                selection={selection}
                baseUrls={{ a: baseUrlA, b: baseUrlB }}
              />
            ))}
            {filteredPairs.length === 0 && (
              <P className="p-2 text-sm text-muted-foreground">
                {t('picker.searchEmpty')}
              </P>
            )}
          </ul>
        ) : (
          <>
            <SourceLayerSection
              slot="a"
              source={sourceA}
              selection={selection}
              query={query}
            />
            <SourceLayerSection
              slot="b"
              source={sourceB}
              selection={selection}
              query={query}
            />
          </>
        )}
      </div>
    </aside>
  )
}

function PairRow({
  pair,
  selection,
  baseUrls,
}: {
  pair: PairedLayer
  selection: CompareSelection
  baseUrls: Record<SourceSlot, string>
}) {
  const { t } = useTranslation('compare')
  const active = selection.isPairActive(pair.key)
  const title =
    pair.level !== null
      ? `${pair.title} · ${pair.level} ${pair.levelUnit ?? 'hPa'}`
      : pair.title

  return (
    <li
      className={cn(
        'rounded-md border transition-colors',
        active ? 'border-primary/40 bg-primary/5' : 'border-transparent',
      )}
    >
      <button
        type="button"
        onClick={() => selection.togglePair(pair.key)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <P className="truncate text-sm font-medium" title={title}>
            {title}
          </P>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {(['a', 'b'] as const).map((slot) => (
            <span
              key={slot}
              title={
                pair.perSource[slot]
                  ? t('link.availableIn', { slots: slot.toUpperCase() })
                  : t('link.notAvailableIn', { slot: slot.toUpperCase() })
              }
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded font-mono text-[10px] font-bold',
                pair.perSource[slot]
                  ? SLOT_CHIP_CLASS[slot]
                  : 'border border-dashed border-border text-muted-foreground/60',
              )}
            >
              {slot.toUpperCase()}
            </span>
          ))}
          {active ? (
            <X className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Plus className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      </button>
      {active && (
        <div className="space-y-2 px-2 pb-2">
          <Slider
            value={[Math.round(selection.pairOpacity(pair.key) * 100)]}
            min={0}
            max={100}
            step={1}
            aria-label={`${title} opacity`}
            onValueChange={(v) =>
              selection.setPairOpacity(pair.key, firstNumber(v) / 100)
            }
          />
          {/* Per-source legends — differing color scales must be visible. */}
          {(['a', 'b'] as const).flatMap((slot) => {
            const layer = pair.perSource[slot]
            const legendUrl = layer?.styles[0]?.legendUrl
            if (!layer || !legendUrl) return []
            return [
              <div key={slot} className="flex items-start gap-1.5">
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
                    SLOT_CHIP_CLASS[slot],
                  )}
                >
                  {slot.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <LegendImage
                    url={rebaseLensUrl(legendUrl, baseUrls[slot])}
                    title={`${title} (${slot.toUpperCase()})`}
                  />
                </div>
              </div>,
            ]
          })}
        </div>
      )}
    </li>
  )
}

/** Per-source layer list for unlinked mode. */
function SourceLayerSection({
  slot,
  source,
  selection,
  query,
}: {
  slot: SourceSlot
  source: LensSource
  selection: CompareSelection
  query: string
}) {
  const layers = source.layers.filter(
    (l) =>
      !query ||
      l.title.toLowerCase().includes(query) ||
      l.name.toLowerCase().includes(query),
  )
  return (
    <section>
      <P className="flex items-center gap-1.5 px-1 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded font-mono text-[10px] font-bold',
            SLOT_CHIP_CLASS[slot],
          )}
        >
          {slot.toUpperCase()}
        </span>
      </P>
      <ul className="space-y-0.5">
        {layers.map((layer) => {
          const active = selection.isLayerActive(slot, layer.name)
          return (
            <li key={layer.name}>
              <button
                type="button"
                onClick={() => selection.toggleLayer(slot, layer.name)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent',
                  active && 'bg-primary/10',
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={layer.title}>
                  {layer.title}
                </span>
                {active ? (
                  <X className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
