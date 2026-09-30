/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Pan pad and zoom pill for every map panel, flat or globe: moving the map without dragging. */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Minus,
  Plus,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NAV_PAN_PX, NAV_ZOOM_STEP } from './map-nav'
import { keyLabel } from './useGeoShortcuts'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function MapNavControls({
  onPan,
  onZoom,
}: {
  /** Screen px; +dy moves the view down. */
  onPan: (dx: number, dy: number) => void
  onZoom: (delta: number) => void
}) {
  const { t } = useTranslation('visualise')
  const button = (
    label: string,
    key: string,
    Icon: LucideIcon,
    onClick: () => void,
    className: string,
    iconClassName?: string,
  ) => (
    <Button
      variant="ghost"
      title={`${label} (${key})`}
      aria-label={label}
      onClick={onClick}
      // Each wedge or half is its own target: the 44 px hit halo would overlap a neighbour.
      className={cn(
        'rounded-none px-0 text-muted-foreground before:hidden focus-visible:border-transparent focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-0',
        className,
      )}
    >
      <Icon className={iconClassName} />
    </Button>
  )
  const surface =
    'border border-border/60 bg-background/60 shadow-xs backdrop-blur-md has-focus-visible:ring-3 has-focus-visible:ring-ring/50'
  const wedge = (
    label: string,
    key: string,
    Icon: LucideIcon,
    onClick: () => void,
    cell: string,
  ) => button(label, key, Icon, onClick, cn('size-full', cell), '-rotate-45')
  return (
    // Faded at rest so the data reads first; full strength while in use.
    <div className="absolute top-2 right-2 z-10 flex touch-manipulation items-center gap-1.5 opacity-70 transition-opacity hover:opacity-100 has-focus-visible:opacity-100 motion-reduce:transition-none">
      <div
        role="group"
        aria-label={t('nav.pan')}
        className={cn('size-16 rounded-full', surface)}
      >
        {/* A square grid turned 45 deg: its quadrants are the up/right/down/left wedges. */}
        <div className="grid size-full rotate-45 grid-cols-2 grid-rows-2 overflow-hidden rounded-full">
          {wedge(
            t('nav.panUp'),
            keyLabel('ArrowUp'),
            ChevronUp,
            () => onPan(0, -NAV_PAN_PX),
            'col-start-1 row-start-1',
          )}
          {wedge(
            t('nav.panRight'),
            keyLabel('ArrowRight'),
            ChevronRight,
            () => onPan(NAV_PAN_PX, 0),
            'col-start-2 row-start-1',
          )}
          {wedge(
            t('nav.panDown'),
            keyLabel('ArrowDown'),
            ChevronDown,
            () => onPan(0, NAV_PAN_PX),
            'col-start-2 row-start-2',
          )}
          {wedge(
            t('nav.panLeft'),
            keyLabel('ArrowLeft'),
            ChevronLeft,
            () => onPan(-NAV_PAN_PX, 0),
            'col-start-1 row-start-2',
          )}
        </div>
      </div>
      <div
        role="group"
        aria-label={t('nav.zoom')}
        className={cn(
          'flex h-16 w-8 flex-col overflow-hidden rounded-full',
          surface,
        )}
      >
        {button(
          t('nav.zoomIn'),
          '+',
          Plus,
          () => onZoom(NAV_ZOOM_STEP),
          'h-auto flex-1',
        )}
        <span className="mx-2 h-px shrink-0 bg-border" />
        {button(
          t('nav.zoomOut'),
          '−',
          Minus,
          () => onZoom(-NAV_ZOOM_STEP),
          'h-auto flex-1',
        )}
      </div>
    </div>
  )
}
