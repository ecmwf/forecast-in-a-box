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
 * Per-slot panel chrome around a comparison source: slot tag + label
 * header, and honest lifecycle states (resolving/starting/failed/stopped)
 * while the lens comes up. A running source currently hosts the
 * single-source WmsViewer; the synchronized comparison viewer replaces
 * this body in the next phase (see GEO_COMPARISON_PLAN.md).
 */

import { Suspense, lazy } from 'react'
import { AlertTriangle, Loader2, Play, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { entryDisplayName } from '../entry-ref'
import { useEnrichComparisonEntry } from '../hooks/useEnrichComparisonEntry'
import { SLOT_BADGE_CLASS } from './CompareBasketChip'
import type { ComparisonEntry } from '../entry-ref'
import type { ComparisonSourceState } from '../hooks/useComparisonSource'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

const WmsViewer = lazy(
  () => import('@/features/executions/components/WmsViewer'),
)

export function ComparePanel({
  slot,
  entry,
  state,
}: {
  slot: 'A' | 'B'
  entry: ComparisonEntry | null
  state: ComparisonSourceState
}) {
  const { t } = useTranslation('compare')

  return (
    <div className="flex h-[600px] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-xs font-bold',
            SLOT_BADGE_CLASS[slot],
          )}
        >
          {slot}
        </span>
        <P className="truncate text-sm font-medium">
          {entry ? entryDisplayName(entry) : t('panel.emptySlot')}
        </P>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {entry && <PanelEnrichment entry={entry} />}
        <PanelBody slot={slot} state={state} />
      </div>
    </div>
  )
}

/** Null-rendering mount point for the per-entry enrichment hook. */
function PanelEnrichment({ entry }: { entry: ComparisonEntry }) {
  useEnrichComparisonEntry(entry)
  return null
}

function PanelBody({
  slot,
  state,
}: {
  slot: 'A' | 'B'
  state: ComparisonSourceState
}) {
  const { t } = useTranslation('compare')

  switch (state.phase) {
    case 'idle':
      return <Centered muted>{t('panel.pickPrompt')}</Centered>
    case 'resolvingDir':
      return (
        <Centered muted>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('lens.resolving')}
        </Centered>
      )
    case 'starting':
      return (
        <Centered muted>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('lens.starting')}
        </Centered>
      )
    case 'dirError':
    case 'failed': {
      const message =
        state.phase === 'dirError'
          ? state.error || t('lens.dirError')
          : (state.error ?? t('lens.failed'))
      return (
        <Centered>
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="max-w-sm text-destructive">{message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={state.retry}
            className="gap-1.5"
          >
            <RefreshCw className="h-3 w-3" />
            {t('lens.retry')}
          </Button>
        </Centered>
      )
    }
    case 'stopped':
      return (
        <Centered muted>
          {t('lens.paused')}
          <Button
            variant="outline"
            size="sm"
            onClick={state.start}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            {t('lens.start')}
          </Button>
        </Centered>
      )
    case 'running':
      return (
        <Suspense
          fallback={
            <Centered muted>
              <Loader2 className="h-4 w-4 animate-spin" />
            </Centered>
          }
        >
          <WmsViewer key={`${slot}:${state.baseUrl}`} baseUrl={state.baseUrl} />
        </Suspense>
      )
  }
}

function Centered({
  children,
  muted = false,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm',
        muted && 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
