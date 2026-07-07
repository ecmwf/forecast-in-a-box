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

import { FlaskConical, Globe2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LinkMode } from './useCompareSelection'
import type { CompareMode } from './types'
import { Button } from '@/components/ui/button'
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
}: {
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  linkMode: LinkMode
  onLinkModeChange: (mode: LinkMode) => void
  /** Zero layer overlap — linking is impossible. */
  linkDisabled: boolean
  onFit: (() => void) | null
}) {
  const { t } = useTranslation('compare')
  const { t: tExec } = useTranslation('executions')

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-2.5 py-2">
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
  )
}
