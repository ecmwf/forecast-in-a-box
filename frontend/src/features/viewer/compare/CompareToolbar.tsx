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
  Download,
  Eraser,
  FlaskConical,
  GitCompareArrows,
  Globe2,
  HelpCircle,
  Layers,
  MessageSquarePlus,
  Ruler,
  SquareDashed,
  ZoomIn,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber } from '../format'
import {
  COMPARE_KEYS,
  keyLabel,
  useShortcutReveal,
} from './useCompareShortcuts'
import { COMPARE_MODES } from './types'
import type { LinkMode } from './useCompareSelection'
import type { CompareMode, CompareModeOptions } from './types'
import type { BasemapOption } from '../ol-layers'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { P } from '@/components/base/typography'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

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

export function CompareToolbar({
  solo = false,
  onRequestAddSource,
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
  onExport,
  basemapId,
  onBasemapChange,
  availableBasemaps,
  basemapOpacity,
  onBasemapOpacityChange,
  onHelp,
}: {
  /** Single-source: modes + link hidden, "Compare…" CTA in their place. */
  solo?: boolean
  onRequestAddSource?: () => void
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
  onExport: () => void
  basemapId: string
  onBasemapChange: (id: string) => void
  availableBasemaps: ReadonlyArray<BasemapOption>
  basemapOpacity: number
  onBasemapOpacityChange: (opacity: number) => void
  onHelp: () => void
}) {
  const { t } = useTranslation('compare')
  const { t: tExec } = useTranslation('executions')
  const reveal = useShortcutReveal()

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {solo ? (
          // The progressive-disclosure hinge: where the mode switcher will
          // appear once a second source exists.
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onRequestAddSource}
            disabled={!onRequestAddSource}
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            {t('toolbar.compareCta')}
          </Button>
        ) : (
        <div
          role="group"
          aria-label={t('page.title')}
          className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {COMPARE_MODES.map((id, index) => (
            <button
              key={id}
              type="button"
              onClick={() => onModeChange(id)}
              aria-pressed={mode === id}
              title={
                EXPERIMENTAL.has(id)
                  ? `${t('modes.experimental')} (${keyLabel(COMPARE_KEYS.modes[index])})`
                  : `(${keyLabel(COMPARE_KEYS.modes[index])})`
              }
              className={cn(
                'relative inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
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
        )}
        <div className="flex items-center gap-3">
          {!solo && (
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
                    <span>{b.label}</span>
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
          <span className="mx-1 h-5 w-px bg-border" />
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
      {!solo && (
        <ModeActionRow
          mode={mode}
          options={options}
          onChange={onOptionsChange}
        />
      )}
    </div>
  )
}

/** Contextual controls for the active mode (empty for side-by-side). */
function ModeActionRow({
  mode,
  options,
  onChange,
}: {
  mode: CompareMode
  options: CompareModeOptions
  onChange: (patch: Partial<CompareModeOptions>) => void
}) {
  const { t } = useTranslation('compare')
  if (mode === 'side') return null

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-border/60 pt-2 text-sm">
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
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <ZoomIn className="h-3.5 w-3.5" />
        {t('modes.loupeHint')}
      </span>
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
