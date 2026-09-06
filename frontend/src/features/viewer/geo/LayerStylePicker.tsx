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
 * Per-layer style picker: a listbox (title + legend strip) beside a
 * preview pane for the highlighted style — legend and live thumbnail per side.
 */

import { ChevronDown, Palette, Pin } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  previewFrame,
  usePrefetchStylePreviews,
  useStylePreview,
} from '../style-preview'
import { SLOT_CHIP_CLASS } from './GeoLayerBrowser'
import { LayerControlLabel } from './LayerControlLabel'
import type { PreviewFrame } from '../style-preview'
import type { SourceSlot } from './layer-pairing'
import type View from 'ol/View'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

export interface StyleOption {
  name: string
  title: string
  abstract?: string
  /** Sides whose layer advertises this style. */
  slots: ReadonlyArray<SourceSlot>
  /** Legend strip / full legend URL per side (already rebased). */
  strip: Partial<Record<SourceSlot, string>>
  legend: Partial<Record<SourceSlot, string>>
}

export function LayerStylePicker({
  layerTitle,
  options,
  value,
  onChange,
  showSlots,
  view,
  previewUrl,
  prefetchConcurrency,
  pinned,
  onPin,
}: {
  layerTitle: string
  options: ReadonlyArray<StyleOption>
  /** Chosen style name; null = each side's server default. */
  value: string | null
  onChange: (name: string | null) => void
  /** Compare mode: mark sides that lack a style. */
  showSlots: boolean
  view: View
  /** GetMap thumbnail URL for a style on a side, or null when unknown. */
  previewUrl: (
    name: string,
    slot: SourceSlot,
    frame: PreviewFrame,
  ) => string | null
  prefetchConcurrency: number
  /** The user's pinned default for this layer (persisted), if any. */
  pinned: string | null
  /** Pin a style as the default (null unpins); pinning also applies it. */
  onPin: (name: string | null) => void
}) {
  const { t } = useTranslation('visualise')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const defaultName = options[0]?.name ?? null
  const current = options.find((o) => o.name === (value ?? defaultName))
  const active = highlight ?? current?.name ?? defaultName

  // Frame snapshot per opening — panning underneath must not refetch.
  const frame = useMemo(() => (open ? previewFrame(view) : null), [open, view])
  const urlsFor = useMemo(() => {
    const map = new Map<string, Partial<Record<SourceSlot, string>>>()
    if (!frame) return map
    for (const option of options) {
      const perSlot: Partial<Record<SourceSlot, string>> = {}
      for (const slot of option.slots) {
        const url = previewUrl(option.name, slot, frame)
        if (url) perSlot[slot] = url
      }
      map.set(option.name, perSlot)
    }
    return map
  }, [frame, options, previewUrl])
  const allUrls = useMemo(
    () => [...urlsFor.values()].flatMap((m) => Object.values(m)),
    [urlsFor],
  )
  usePrefetchStylePreviews(allUrls, open, prefetchConcurrency)

  useEffect(() => {
    if (!open) setHighlight(null)
  }, [open])

  const focusOption = (index: number) => {
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    if (!buttons || buttons.length === 0) return
    const i = (index + buttons.length) % buttons.length
    buttons[i].focus()
  }

  const activeOption = options.find((o) => o.name === active)

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <LayerControlLabel
        icon={Palette}
        label={t('sidebar.style')}
        help={t('sidebar.styleHelp')}
        helpAria={t('sidebar.styleHelpAria')}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              className="min-w-0 flex-1 justify-between gap-1.5 font-normal"
              aria-label={t('sidebar.stylePicker', { name: layerTitle })}
              title={t('sidebar.stylePicker', { name: layerTitle })}
            />
          }
        >
          {current && current.name === pinned && (
            <Pin className="size-3 shrink-0 text-primary" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {current?.title ?? t('sidebar.styleDefault')}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="max-h-[min(80vh,48rem)] w-[36rem] max-w-[calc(100vw-2rem)] flex-row items-stretch gap-0 p-0"
        >
          <ul
            ref={listRef}
            role="listbox"
            aria-label={t('sidebar.stylePicker', { name: layerTitle })}
            className="min-h-0 w-60 shrink-0 self-stretch overflow-y-auto p-1"
            onKeyDown={(e) => {
              const buttons =
                listRef.current?.querySelectorAll('[role="option"]')
              const index = buttons
                ? Array.from(buttons).indexOf(document.activeElement as Element)
                : -1
              if (e.key === 'ArrowDown') focusOption(index + 1)
              else if (e.key === 'ArrowUp') focusOption(index - 1)
              else if (e.key === 'Home') focusOption(0)
              else if (e.key === 'End') focusOption(-1)
              else return
              e.preventDefault()
            }}
          >
            {options.map((option) => {
              const selected = option.name === (current?.name ?? defaultName)
              const strip =
                option.strip.a ??
                option.strip.b ??
                Object.values(option.strip)[0]
              const missing = showSlots
                ? (['a', 'b'] as const).filter((s) => !option.slots.includes(s))
                : []
              return (
                <li key={option.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlight(option.name)}
                    onFocus={() => setHighlight(option.name)}
                    onClick={() => {
                      onChange(option.name === defaultName ? null : option.name)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent',
                      selected && 'bg-accent font-medium',
                      active === option.name && 'bg-accent',
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span
                        className="line-clamp-2 min-w-0 flex-1 leading-tight break-words"
                        title={option.title}
                      >
                        {option.title}
                      </span>
                      {option.name === pinned && (
                        <Pin
                          className="size-3 shrink-0 text-primary"
                          aria-label={t('sidebar.stylePinned')}
                        />
                      )}
                      {option.slots.map((slot) =>
                        missing.length > 0 ? (
                          <span
                            key={slot}
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold',
                              SLOT_CHIP_CLASS[slot],
                            )}
                            title={t('sidebar.styleOnlyInHint', {
                              slot: slot.toUpperCase(),
                            })}
                          >
                            {slot.toUpperCase()}
                          </span>
                        ) : null,
                      )}
                    </span>
                    {strip && (
                      <img
                        src={strip}
                        alt=""
                        loading="lazy"
                        className="h-5 w-full rounded-md bg-white object-contain object-left p-0.5"
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-l border-border p-3">
            {activeOption && (
              <>
                <div className="flex items-start gap-2">
                  <P className="min-w-0 flex-1 text-sm font-medium">
                    {activeOption.title}
                  </P>
                  <Button
                    variant={activeOption.name === pinned ? 'default' : 'ghost'}
                    size="icon-xs"
                    aria-pressed={activeOption.name === pinned}
                    title={
                      activeOption.name === pinned
                        ? t('sidebar.styleUnpin')
                        : t('sidebar.stylePin')
                    }
                    aria-label={
                      activeOption.name === pinned
                        ? t('sidebar.styleUnpin')
                        : t('sidebar.stylePin')
                    }
                    onClick={() => {
                      if (activeOption.name === pinned) {
                        onPin(null)
                      } else {
                        onPin(activeOption.name)
                        onChange(
                          activeOption.name === defaultName
                            ? null
                            : activeOption.name,
                        )
                      }
                    }}
                  >
                    <Pin className="size-3" />
                  </Button>
                </div>
                <P className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {activeOption.name}
                </P>
                {activeOption.abstract && (
                  <P className="mt-1 line-clamp-4 text-xs text-muted-foreground">
                    {activeOption.abstract}
                  </P>
                )}
                <div className="mt-2 space-y-2">
                  {activeOption.slots.map((slot) => (
                    <StylePreview
                      key={slot}
                      slot={slot}
                      showSlot={showSlots}
                      url={urlsFor.get(activeOption.name)?.[slot] ?? null}
                      legend={activeOption.legend[slot]}
                      title={activeOption.title}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function StylePreview({
  slot,
  showSlot,
  url,
  legend,
  title,
}: {
  slot: SourceSlot
  showSlot: boolean
  url: string | null
  legend: string | undefined
  title: string
}) {
  const { t } = useTranslation('visualise')
  const preview = useStylePreview(url)
  return (
    <div className="flex items-start gap-1.5">
      {showSlot && (
        <span
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold',
            SLOT_CHIP_CLASS[slot],
          )}
        >
          {slot.toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div
          role="img"
          aria-label={t('sidebar.stylePreview', { name: title })}
          className="flex min-h-24 items-center justify-center overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:12px_12px]"
        >
          {preview.src ? (
            <img src={preview.src} alt="" className="block w-full" />
          ) : (
            <span className="px-2 py-6 text-xs text-muted-foreground">
              {preview.loading
                ? t('sidebar.stylePreviewLoading')
                : t('sidebar.stylePreviewUnavailable')}
            </span>
          )}
        </div>
        {legend && (
          <img
            src={legend}
            alt=""
            loading="lazy"
            className="max-h-24 max-w-full rounded-md bg-white object-contain p-0.5"
          />
        )}
      </div>
    </div>
  )
}
