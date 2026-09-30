/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A source's status pills under its slot tag: data gap, failed layers, time offset. */

import { useTranslation } from 'react-i18next'
import { NAV_CLEARANCE } from './map-nav'
import type { ReactNode } from 'react'
import type { ParsedLayer } from '../wms-capabilities'
import type { CompareMapSource } from './types'
import { cn } from '@/lib/utils'

/** Failing layer names -> display titles for the badge. */
function erroredTitles(
  names: ReadonlyArray<string>,
  layers: ReadonlyArray<ParsedLayer>,
): Array<string> {
  return names.map((n) => layers.find((l) => l.name === n)?.title ?? n)
}

/** Status pills stacked under a slot tag, on its side of the panel. */
export function PanelCorner({
  side,
  children,
}: {
  side: 'left' | 'right'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'absolute top-10 z-10 flex flex-col gap-1.5',
        side === 'left' ? 'left-2 items-start' : [NAV_CLEARANCE, 'items-end'],
      )}
    >
      {children}
    </div>
  )
}

export function SlotStatusBadges({
  source,
  erroredNames,
}: {
  source: Pick<CompareMapSource, 'slot' | 'layers' | 'hiddenAtTime' | 'timeTag'>
  erroredNames: ReadonlyArray<string>
}) {
  const { t } = useTranslation('visualise')
  const slot = source.slot.toUpperCase()
  // Titles of the affected layers — named so intact layers aren't accused.
  const titles = erroredTitles(erroredNames, source.layers)
  const more = titles.length - 2
  const shown = titles.slice(0, 2).join(', ')
  return (
    <>
      {source.hiddenAtTime ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/95 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          {t('timeline.gap', { slot })}
        </div>
      ) : (
        // No image for the requested instant: the layer is hidden, never an older image.
        titles.length > 0 && (
          <div className="max-w-64 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-danger">
            {t('timeline.loadErrorLayers', {
              slot,
              layers: more > 0 ? `${shown} +${more}` : shown,
            })}
          </div>
        )
      )}
      {source.timeTag && (
        <div className="rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-xs font-medium shadow-sm backdrop-blur-sm">
          {t('timeline.offsetBadge', { slot, tag: source.timeTag })}
        </div>
      )}
    </>
  )
}
