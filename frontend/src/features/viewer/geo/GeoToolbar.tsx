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
 * Mode switcher + link toggle + fit for the compare viewer. Swipe and
 * side-by-side are the primary modes; flicker/spy/blend are experiments
 * under evaluation (each is one small controller — trivially removable)
 * and are marked as such.
 */

import {
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FlaskConical,
  Globe2,
  HelpCircle,
  Layers,
  MessageSquarePlus,
  Ruler,
  SquareDashed,
  Upload,
  ZoomIn,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { firstNumber } from '../format'
import {
  downloadAnnotationsGeojson,
  parseAnnotationsGeojson,
} from './annotations'
import { COMPARE_KEYS, keyLabel, useShortcutReveal } from './useGeoShortcuts'
import { COMPARE_MODES } from './types'
import type { LinkMode } from './useCompareSelection'
import type { SourceSlot } from './layer-pairing'
import type { CompareMode, CompareModeOptions } from './types'
import type { MapAnnotation } from './annotations'
import type { BasemapOption } from '../ol-layers'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const log = createLogger('GeoToolbar')

const EXPERIMENTAL: ReadonlySet<CompareMode> = new Set([
  'flicker',
  'spy',
  'blend',
])

/** Shortcut badge shown while ⌘/Ctrl is held. */
function KeyBadge({ label, show }: { label: string; show: boolean }) {
  if (!show) return null
  return (
    <kbd className="absolute -top-1.5 -right-1.5 z-10 rounded border border-border bg-foreground px-1 font-mono text-[9px] leading-4 text-background shadow-sm">
      {label}
    </kbd>
  )
}

/** Source-focus control (A · both · B); selected A/B use their source colour. */
const FOCUS_CHOICES = [
  {
    slot: 'a',
    label: 'A',
    title: 'viewA',
    on: 'bg-blue-600 text-white shadow-sm dark:bg-blue-500',
  },
  {
    slot: null,
    label: 'A·B',
    title: 'viewBoth',
    on: 'bg-background text-foreground shadow-sm',
  },
  {
    slot: 'b',
    label: 'B',
    title: 'viewB',
    on: 'bg-orange-600 text-white shadow-sm dark:bg-orange-500',
  },
] as const

export function GeoToolbar({
  solo = false,
  focusSlot = null,
  onFocusChange,
  mode,
  onModeChange,
  linkMode,
  onLinkModeChange,
  linkDisabled,
  onFit,
  options,
  onOptionsChange,
  measureMode,
  onMeasureMode,
  onMeasureClear,
  annotateArmed,
  onAnnotateToggle,
  annotations,
  onAnnotationsImport,
  onExport,
  onCopy,
  copySlots,
  basemapId,
  onBasemapChange,
  availableBasemaps,
  basemapOpacity,
  onBasemapOpacityChange,
  onHelp,
}: {
  /** Single-source: comparison modes + link toggle hidden. */
  solo?: boolean
  /** View only one source (null = both); collapses the combination modes. */
  focusSlot?: SourceSlot | null
  onFocusChange?: (slot: SourceSlot | null) => void
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  linkMode: LinkMode
  onLinkModeChange: (mode: LinkMode) => void
  /** Zero layer overlap — linking is impossible. */
  linkDisabled: boolean
  onFit: (() => void) | null
  options: CompareModeOptions
  onOptionsChange: (patch: Partial<CompareModeOptions>) => void
  measureMode: 'none' | 'line' | 'area'
  onMeasureMode: (mode: 'none' | 'line' | 'area') => void
  onMeasureClear: () => void
  annotateArmed: boolean
  onAnnotateToggle: () => void
  annotations: ReadonlyArray<MapAnnotation>
  onAnnotationsImport: (items: ReadonlyArray<Omit<MapAnnotation, 'id'>>) => void
  onExport: () => void
  /** Copy the view (null) or one slot's clean image. */
  onCopy: (only: SourceSlot | null) => void
  /** Offer the per-slot copy menu (comparison only). */
  copySlots: boolean
  basemapId: string
  onBasemapChange: (id: string) => void
  availableBasemaps: ReadonlyArray<BasemapOption>
  basemapOpacity: number
  onBasemapOpacityChange: (opacity: number) => void
  onHelp: () => void
}) {
  const { t } = useTranslation('visualise')
  const annotationFileRef = useRef<HTMLInputElement>(null)

  const onAnnotationFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      onAnnotationsImport(parseAnnotationsGeojson(text))
    } catch (err) {
      log.error('Annotations GeoJSON parse failed', { error: err })
      showToast.error(t('annotations.importInvalid'))
    }
    if (annotationFileRef.current) annotationFileRef.current.value = ''
  }

  const { t: tExec } = useTranslation('executions')
  const reveal = useShortcutReveal()

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {solo ? (
          // Modes appear here once a second source exists ("Add source"
          // in the page header is the way in).
          <div />
        ) : (
          <div className="flex items-center gap-2">
            {/* Source focus: view A, both, or B. */}
            <div
              role="group"
              aria-label={t('focus.aria')}
              className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
            >
              {FOCUS_CHOICES.map(({ slot, label, title, on }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onFocusChange?.(slot)}
                  aria-pressed={focusSlot === slot}
                  aria-label={t(`focus.${title}`)}
                  title={t(`focus.${title}`)}
                  className={cn(
                    'rounded-md px-2 py-1 text-sm font-medium transition-colors',
                    focusSlot === slot
                      ? on
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="h-5 w-px bg-border" aria-hidden="true" />
            {/* Combination modes — inert while focused on one source. */}
            <div
              role="group"
              aria-label={t('page.title')}
              className={cn(
                'flex items-center gap-0.5 rounded-lg bg-muted p-0.5 transition-opacity',
                focusSlot !== null && 'opacity-40',
              )}
            >
              {COMPARE_MODES.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  disabled={focusSlot !== null}
                  onClick={() => onModeChange(id)}
                  aria-pressed={mode === id}
                  title={
                    EXPERIMENTAL.has(id)
                      ? `${t('modes.experimental')} (${keyLabel(COMPARE_KEYS.modes[index])})`
                      : `(${keyLabel(COMPARE_KEYS.modes[index])})`
                  }
                  className={cn(
                    'relative inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors disabled:pointer-events-none',
                    mode === id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <KeyBadge
                    label={keyLabel(COMPARE_KEYS.modes[index])}
                    show={reveal}
                  />
                  {t(`modes.${id}`)}
                  {EXPERIMENTAL.has(id) && (
                    <FlaskConical className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          {!solo && focusSlot === null && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                size="sm"
                checked={linkMode === 'linked'}
                disabled={linkDisabled}
                onCheckedChange={(checked) =>
                  onLinkModeChange(checked ? 'linked' : 'unlinked')
                }
                aria-label={t('link.toggleAria')}
              />
              <span
                className={cn(
                  linkMode === 'linked'
                    ? 'font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {linkMode === 'linked' ? t('link.linked') : t('link.unlinked')}
              </span>
            </label>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="relative h-7 w-7"
            disabled={!onFit}
            onClick={() => onFit?.()}
            title={`${tExec('lens.fitGlobe')} (${keyLabel(COMPARE_KEYS.fit)})`}
            aria-label={tExec('lens.fitGlobe')}
          >
            <KeyBadge label={keyLabel(COMPARE_KEYS.fit)} show={reveal} />
            <Globe2 className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={tExec('lens.basemap')}
                  aria-label={tExec('lens.basemap')}
                />
              }
            >
              <Layers className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-64 p-1">
              <P className="px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {tExec('lens.basemap')}
              </P>
              <div className="flex flex-col">
                {availableBasemaps.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onBasemapChange(b.id)}
                    aria-pressed={b.id === basemapId}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                      b.id === basemapId && 'bg-accent font-medium',
                    )}
                  >
                    <span>{t(b.labelKey)}</span>
                    {b.id === basemapId && (
                      <span className="text-xs text-muted-foreground">✓</span>
                    )}
                  </button>
                ))}
              </div>
              <label className="mt-1 block space-y-1 border-t border-border px-2 pt-2 pb-1">
                <span className="flex items-center justify-between text-xs text-muted-foreground">
                  {tExec('lens.basemapOpacity')}
                  <span className="font-mono tabular-nums">
                    {Math.round(basemapOpacity * 100)}%
                  </span>
                </span>
                <Slider
                  value={[Math.round(basemapOpacity * 100)]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) =>
                    onBasemapOpacityChange(firstNumber(v) / 100)
                  }
                />
              </label>
            </PopoverContent>
          </Popover>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            variant={measureMode === 'line' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            aria-pressed={measureMode === 'line'}
            onClick={() =>
              onMeasureMode(measureMode === 'line' ? 'none' : 'line')
            }
            title={t('measure.line')}
            aria-label={t('measure.line')}
          >
            <Ruler className="h-4 w-4" />
          </Button>
          <Button
            variant={measureMode === 'area' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            aria-pressed={measureMode === 'area'}
            onClick={() =>
              onMeasureMode(measureMode === 'area' ? 'none' : 'area')
            }
            title={t('measure.area')}
            aria-label={t('measure.area')}
          >
            <SquareDashed className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onMeasureClear}
            title={t('measure.clear')}
            aria-label={t('measure.clear')}
          >
            <Eraser className="h-4 w-4" />
          </Button>
          <span className="flex items-center">
            <Button
              variant={annotateArmed ? 'secondary' : 'ghost'}
              size="icon"
              className="relative h-7 w-7"
              aria-pressed={annotateArmed}
              onClick={onAnnotateToggle}
              title={`${t('annotations.tool')} (${keyLabel(COMPARE_KEYS.annotate)})`}
              aria-label={t('annotations.tool')}
            >
              <KeyBadge label={keyLabel(COMPARE_KEYS.annotate)} show={reveal} />
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-1 h-7 w-4"
                    title={t('annotations.options')}
                    aria-label={t('annotations.options')}
                  />
                }
              >
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-60">
                <DropdownMenuItem
                  onClick={() => annotationFileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('annotations.import')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={annotations.length === 0}
                  onClick={() => downloadAnnotationsGeojson(annotations)}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('annotations.export')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={annotationFileRef}
              type="file"
              accept=".json,.geojson,application/geo+json,application/json"
              className="hidden"
              aria-label={t('annotations.import')}
              onChange={(e) => void onAnnotationFiles(e.target.files)}
            />
          </span>
          <span className="mx-1 h-5 w-px bg-border" />
          <span className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="relative h-7 w-7"
              onClick={() => onCopy(null)}
              title={`${tExec('lens.copyMap')} (${keyLabel(COMPARE_KEYS.copy)})`}
              aria-label={tExec('lens.copyMap')}
            >
              <KeyBadge label={keyLabel(COMPARE_KEYS.copy)} show={reveal} />
              <Copy className="h-4 w-4" />
            </Button>
            {copySlots && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-ml-1 h-7 w-4"
                      title={t('toolbar.copyOptions')}
                      aria-label={t('toolbar.copyOptions')}
                    />
                  }
                >
                  <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onCopy('a')}>
                    {t('toolbar.copySlot', { slot: 'A' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCopy('b')}>
                    {t('toolbar.copySlot', { slot: 'B' })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-7 w-7"
            onClick={onExport}
            title={`${t('export.open')} (${keyLabel(COMPARE_KEYS.export)})`}
            aria-label={t('export.open')}
          >
            <KeyBadge label={keyLabel(COMPARE_KEYS.export)} show={reveal} />
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-7 w-7"
            onClick={onHelp}
            title={`${t('help.open')} (${keyLabel(COMPARE_KEYS.help)})`}
            aria-label={t('help.open')}
          >
            <KeyBadge label={keyLabel(COMPARE_KEYS.help)} show={reveal} />
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!solo && focusSlot === null && (
        <ModeActionRow
          mode={mode}
          options={options}
          onChange={onOptionsChange}
        />
      )}
    </div>
  )
}

/** Contextual controls for the active mode (just the loupe hint for side/flicker). */
function ModeActionRow({
  mode,
  options,
  onChange,
}: {
  mode: CompareMode
  options: CompareModeOptions
  onChange: (patch: Partial<CompareModeOptions>) => void
}) {
  const { t } = useTranslation('visualise')

  // Fixed-height row, always rendered — keeps the divider/toolbar height steady across modes.
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-4 border-t border-border/60 pt-2 text-sm">
      {mode === 'swipe' && (
        <Segmented
          aria={t('modes.orientationAria')}
          value={options.swipeOrientation}
          items={[
            { id: 'vertical', label: t('modes.orientation.vertical') },
            { id: 'horizontal', label: t('modes.orientation.horizontal') },
          ]}
          onChange={(id) =>
            onChange({ swipeOrientation: id as 'vertical' | 'horizontal' })
          }
        />
      )}
      {mode === 'spy' && (
        <>
          <Segmented
            aria={t('modes.spyShapeAria')}
            value={options.spyShape}
            items={[
              { id: 'circle', label: t('modes.spyShape.circle') },
              { id: 'rectangle', label: t('modes.spyShape.rectangle') },
            ]}
            onChange={(id) =>
              onChange({ spyShape: id as 'circle' | 'rectangle' })
            }
          />
          <label className="flex w-48 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{t('modes.spySize')}</span>
            <Slider
              value={[options.spySizePx]}
              min={40}
              max={220}
              step={10}
              onValueChange={(v) => onChange({ spySizePx: firstNumber(v) })}
            />
          </label>
        </>
      )}
      {mode === 'blend' && (
        <label className="flex w-64 items-center gap-2 text-xs">
          <span className="font-mono font-bold">A</span>
          <span className="sr-only">{t('modes.blendLabel')}</span>
          <Slider
            value={[Math.round(options.blend * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => onChange({ blend: firstNumber(v) / 100 })}
          />
          <span className="font-mono font-bold">B</span>
        </label>
      )}
      {/* Loupe controls grouped on the right: the hint, plus the mirror
          toggle when side-by-side. */}
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ZoomIn className="h-3.5 w-3.5" />
          {t('modes.loupeHint')}
        </span>
        <label className="flex w-36 items-center gap-2">
          <span className="shrink-0">{t('modes.loupeSize')}</span>
          <Slider
            value={[options.loupeSizePx]}
            min={120}
            max={360}
            step={20}
            onValueChange={(v) => onChange({ loupeSizePx: firstNumber(v) })}
          />
        </label>
        {mode === 'side' && (
          <label className="flex items-center gap-2">
            <Switch
              size="sm"
              checked={options.loupeMirror}
              onCheckedChange={(v) => onChange({ loupeMirror: v })}
            />
            {t('modes.loupeMirror')}
          </label>
        )}
      </div>
    </div>
  )
}

function Segmented({
  aria,
  value,
  items,
  onChange,
}: {
  aria: string
  value: string
  items: ReadonlyArray<{ id: string; label: string }>
  onChange: (id: string) => void
}) {
  return (
    <div
      role="group"
      aria-label={aria}
      className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          aria-pressed={value === item.id}
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
            value === item.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
