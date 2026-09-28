/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Zoom and nudge buttons for a globe panel: the non-drag way to move it. */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Minus,
  Plus,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** Nudge distance (px) and zoom levels per press. */
const STEP_PX = 80
const ZOOM_STEP = 0.5

export function GlobeControls({
  onZoom,
  onPan,
}: {
  onZoom: (delta: number) => void
  onPan: (dx: number, dy: number) => void
}) {
  const { t } = useTranslation('visualise')
  const button = (label: string, onClick: () => void, Icon: typeof Plus) => (
    <Button
      variant="outline"
      size="icon-xs"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon />
    </Button>
  )
  return (
    // Right edge: the left column under the slot tag holds the status badges.
    <div className="absolute top-10 right-2 z-10 flex items-start gap-2">
      <div
        role="group"
        aria-label={t('globe.nudge')}
        className="grid grid-cols-3 gap-0.5"
      >
        <div />
        {button(t('globe.panNorth'), () => onPan(0, -STEP_PX), ChevronUp)}
        <div />
        {button(t('globe.panWest'), () => onPan(-STEP_PX, 0), ChevronLeft)}
        <div />
        {button(t('globe.panEast'), () => onPan(STEP_PX, 0), ChevronRight)}
        <div />
        {button(t('globe.panSouth'), () => onPan(0, STEP_PX), ChevronDown)}
      </div>
      <div role="group" aria-label={t('globe.zoom')} className="grid gap-0.5">
        {button(t('globe.zoomIn'), () => onZoom(ZOOM_STEP), Plus)}
        {button(t('globe.zoomOut'), () => onZoom(-ZOOM_STEP), Minus)}
      </div>
    </div>
  )
}
