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
 * Active-layers panel (left sidebar) for the compare viewer — mirrors the
 * embedded viewer's layout: what's on the map lives on the left, what's
 * available on the right. Hosts the opacity hierarchy:
 * global × per-source (all-of-A / all-of-B) × per-layer, plus per-source
 * legends and removal.
 */

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Upload, X } from 'lucide-react'
import { firstNumber } from '../format'
import { rebaseLensUrl } from '../wms-capabilities'
import { LegendImage } from '../components/LegendImage'
import { SLOT_CHIP_CLASS } from './CompareLayerBrowser'
import { parseGeojsonOverlay } from './overlays'
import type { ContextOverlay } from './overlays'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'
import type { PairedLayer, SourceSlot } from './layer-pairing'
import type { CompareSelection } from './useCompareSelection'
import type { LensSource } from '../hooks/useLensSource'
import { Slider } from '@/components/ui/slider'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

const log = createLogger('CompareActiveLayersPanel')

export interface OverlayControls {
  items: ReadonlyArray<ContextOverlay>
  add: (overlay: ContextOverlay) => void
  toggle: (id: string) => void
  remove: (id: string) => void
}

export interface OpacityTiers {
  global: number
  setGlobal: (v: number) => void
  source: Record<SourceSlot, number>
  setSource: (slot: SourceSlot, v: number) => void
}

export function CompareActiveLayersPanel({
  pairs,
  selection,
  opacity,
  sources,
  overlays,
}: {
  pairs: ReadonlyArray<PairedLayer>
  selection: CompareSelection
  opacity: OpacityTiers
  sources: Record<
    SourceSlot,
    { label: string; baseUrl: string; lens: LensSource }
  >
  overlays: OverlayControls
}) {
  const { t } = useTranslation('compare')
  const pairByKey = new Map(pairs.map((p) => [p.key, p]))
  const activePairs = selection.linkedOrder
    .map((key) => pairByKey.get(key))
    .filter((p): p is PairedLayer => p !== undefined)

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="space-y-2.5 border-b border-border bg-muted/40 px-3 pt-2.5 pb-3">
        <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('sidebar.active')}
        </P>
        <OpacityRow
          label={t('sidebar.globalOpacity')}
          value={opacity.global}
          onChange={opacity.setGlobal}
        />
        {(['a', 'b'] as const).map((slot) => (
          <OpacityRow
            key={slot}
            label={t('sidebar.sourceOpacity', { slot: slot.toUpperCase() })}
            slot={slot}
            value={opacity.source[slot]}
            onChange={(v) => opacity.setSource(slot, v)}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {selection.linkMode === 'linked' ? (
          activePairs.length === 0 ? (
            <EmptyHint />
          ) : (
            <ul className="space-y-2">
              {activePairs.map((pair) => (
                <ActivePairCard
                  key={pair.key}
                  pair={pair}
                  selection={selection}
                  sources={sources}
                />
              ))}
            </ul>
          )
        ) : (
          <>
            <ActiveSourceSection
              slot="a"
              selection={selection}
              sources={sources}
            />
            <ActiveSourceSection
              slot="b"
              selection={selection}
              sources={sources}
            />
          </>
        )}
      </div>

      <OverlaysSection overlays={overlays} />
    </aside>
  )
}

/** Uploaded GeoJSON context overlays: upload, visibility, removal. */
function OverlaysSection({ overlays }: { overlays: OverlayControls }) {
  const { t } = useTranslation('compare')
  const inputRef = useRef<HTMLInputElement>(null)

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      overlays.add(parseGeojsonOverlay(file.name, text))
    } catch (err) {
      log.error('GeoJSON overlay parse failed', { error: err })
      showToast.error(t('overlays.invalid'))
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <P className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('overlays.title')}
        </P>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3 w-3" />
          {t('overlays.upload')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.geojson,application/geo+json,application/json"
          className="hidden"
          aria-label={t('overlays.upload')}
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      {overlays.items.length > 0 && (
        <ul className="space-y-1">
          {overlays.items.map((overlay) => (
            <li key={overlay.id} className="flex items-center gap-1.5 text-sm">
              <button
                type="button"
                onClick={() => overlays.toggle(overlay.id)}
                aria-pressed={overlay.visible}
                aria-label={
                  overlay.visible
                    ? t('overlays.hide', { name: overlay.name })
                    : t('overlays.show', { name: overlay.name })
                }
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {overlay.visible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </button>
              <span
                className="min-w-0 flex-1 truncate text-xs"
                title={overlay.name}
              >
                {overlay.name}
                <span className="ml-1 text-muted-foreground">
                  {t('overlays.features', { count: overlay.featureCount })}
                </span>
              </span>
              <button
                type="button"
                onClick={() => overlays.remove(overlay.id)}
                aria-label={t('overlays.remove', { name: overlay.name })}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyHint() {
  const { t } = useTranslation('compare')
  return (
    <P className="p-2 text-sm text-muted-foreground">{t('sidebar.empty')}</P>
  )
}

function OpacityRow({
  label,
  value,
  onChange,
  slot,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  slot?: SourceSlot
}) {
  // <label> wraps the slider so its text names the range input (the
  // element carrying role=slider) — aria-label on the styled root is a
  // div and never reaches it.
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {slot && (
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
                SLOT_CHIP_CLASS[slot],
              )}
            >
              {slot.toUpperCase()}
            </span>
          )}
          <span className="truncate">{label}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {Math.round(value * 100)}%
        </span>
      </span>
      <Slider
        value={[Math.round(value * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={(v) => onChange(firstNumber(v) / 100)}
      />
    </label>
  )
}

/** Linked mode: one card per active PAIR, with both sources' legends. */
function ActivePairCard({
  pair,
  selection,
  sources,
}: {
  pair: PairedLayer
  selection: CompareSelection
  sources: Record<
    SourceSlot,
    { label: string; baseUrl: string; lens: LensSource }
  >
}) {
  const { t } = useTranslation('compare')
  const title =
    pair.level !== null
      ? `${pair.title} · ${pair.level} ${pair.levelUnit ?? 'hPa'}`
      : pair.title

  return (
    <li className="rounded-md border border-border bg-card p-2.5">
      <div className="flex items-start gap-2">
        <P
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={title}
        >
          {title}
        </P>
        <button
          type="button"
          onClick={() => selection.togglePair(pair.key)}
          aria-label={t('sidebar.removeLayer', { name: title })}
          title={t('sidebar.removeLayer', { name: title })}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="mt-2 block">
        <span className="sr-only">{`${title} opacity`}</span>
        <Slider
          value={[Math.round(selection.pairOpacity(pair.key) * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) =>
            selection.setPairOpacity(pair.key, firstNumber(v) / 100)
          }
        />
      </label>
      <div className="mt-2 space-y-1.5">
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
                  url={rebaseLensUrl(legendUrl, sources[slot].baseUrl)}
                  title={`${title} (${slot.toUpperCase()})`}
                />
              </div>
            </div>,
          ]
        })}
      </div>
    </li>
  )
}

/** Unlinked mode: per-source active layer cards. */
function ActiveSourceSection({
  slot,
  selection,
  sources,
}: {
  slot: SourceSlot
  selection: CompareSelection
  sources: Record<
    SourceSlot,
    { label: string; baseUrl: string; lens: LensSource }
  >
}) {
  const { t } = useTranslation('compare')
  const { lens, baseUrl, label } = sources[slot]
  const activeNames = selection.activeOrderFor(slot)

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
        <span className="truncate">{label}</span>
      </P>
      {activeNames.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="space-y-2">
          {activeNames.map((name) => {
            const layer = lens.layers.find((l) => l.name === name)
            const title = layer?.title ?? name
            const legendUrl = layer?.styles[0]?.legendUrl
            return (
              <li
                key={name}
                className="rounded-md border border-border bg-card p-2.5"
              >
                <div className="flex items-start gap-2">
                  <P
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    title={title}
                  >
                    {title}
                  </P>
                  <button
                    type="button"
                    onClick={() => selection.toggleLayer(slot, name)}
                    aria-label={t('sidebar.removeLayer', { name: title })}
                    title={t('sidebar.removeLayer', { name: title })}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <label className="mt-2 block">
                  <span className="sr-only">{`${title} opacity`}</span>
                  <Slider
                    value={[
                      Math.round(selection.layerOpacity(slot, name) * 100),
                    ]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) =>
                      selection.setLayerOpacity(
                        slot,
                        name,
                        firstNumber(v) / 100,
                      )
                    }
                  />
                </label>
                {legendUrl && (
                  <div className="mt-2">
                    <LegendImage
                      url={rebaseLensUrl(legendUrl, baseUrl)}
                      title={title}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
