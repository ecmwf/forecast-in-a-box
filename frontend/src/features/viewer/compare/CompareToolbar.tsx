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

import { FlaskConical, Globe2, ZoomIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { firstNumber } from '../format'
import type { LinkMode } from './useCompareSelection'
import type { CompareMode, CompareModeOptions } from './types'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const MODES: ReadonlyArray<{ id: CompareMode; experimental: boolean }> = [
  { id: 'swipe', experimental: false },
  { id: 'side', experimental: false },
  { id: 'flicker', experimental: true },
  { id: 'spy', experimental: true },
  { id: 'blend', experimental: true },
]

export function CompareToolbar({
  mode,
  onModeChange,
  linkMode,
  onLinkModeChange,
  linkDisabled,
  onFit,
  options,
  onOptionsChange,
}: {
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  linkMode: LinkMode
  onLinkModeChange: (mode: LinkMode) => void
  /** Zero layer overlap — linking is impossible. */
  linkDisabled: boolean
  onFit: (() => void) | null
  options: CompareModeOptions
  onOptionsChange: (patch: Partial<CompareModeOptions>) => void
}) {
  const { t } = useTranslation('compare')
  const { t: tExec } = useTranslation('executions')

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t('page.title')}
          className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {MODES.map(({ id, experimental }) => (
            <button
              key={id}
              type="button"
              onClick={() => onModeChange(id)}
              aria-pressed={mode === id}
              title={experimental ? t('modes.experimental') : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                mode === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`modes.${id}`)}
              {experimental && (
                <FlaskConical className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
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
                linkMode === 'linked' ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {linkMode === 'linked' ? t('link.linked') : t('link.unlinked')}
            </span>
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!onFit}
            onClick={() => onFit?.()}
            title={tExec('lens.fitGlobe')}
            aria-label={tExec('lens.fitGlobe')}
          >
            <Globe2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ModeActionRow mode={mode} options={options} onChange={onOptionsChange} />
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
