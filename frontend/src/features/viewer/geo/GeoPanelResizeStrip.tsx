/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** In-flow lg+ resize strip between a viewer sidebar and the map — drag,
 * arrow keys, step buttons, double-click reset. Straddles the flex gap. */

import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { GEO_PANEL_MAX_PX, GEO_PANEL_MIN_PX } from './useGeoPanelWidths'
import type { GeoPanelSide } from './useGeoPanelWidths'
import { SplitHandleChrome } from '@/components/common/SplitResizeHandle'

export function GeoPanelResizeStrip({
  side,
  valueNow,
  getWidth,
  onWidth,
  onReset,
}: {
  side: GeoPanelSide
  /** Width announced to AT (stored width, or the default when unset). */
  valueNow: number
  /** Live panel width — drag/nudge baseline (responsive default when unset). */
  getWidth: () => number
  onWidth: (px: number) => void
  onReset: () => void
}) {
  const { t } = useTranslation('visualise')
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const strip = e.currentTarget as HTMLElement
      strip.setAttribute('data-dragging', '')
      startXRef.current = e.clientX
      startWidthRef.current = getWidth()
      let moved = false
      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current
        if (Math.abs(delta) > 3) moved = true
        // Left panel: drag right = wider. Right panel: drag left = wider.
        onWidth(
          side === 'left'
            ? startWidthRef.current + delta
            : startWidthRef.current - delta,
        )
      }
      const onUp = () => {
        strip.removeAttribute('data-dragging')
        // Only a clean click selects (shows the steppers); a drag never pins them.
        if (!moved) strip.focus()
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [getWidth, onWidth, side],
  )

  // Divider-motion semantics: moving it towards the map grows the panel.
  const growKey = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('panel.resize')}
      aria-valuemin={GEO_PANEL_MIN_PX}
      aria-valuemax={GEO_PANEL_MAX_PX}
      aria-valuenow={valueNow}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          onWidth(getWidth() + (e.key === growKey ? 16 : -16))
        }
      }}
      className="group/split relative z-20 -mx-1.5 w-3 shrink-0 cursor-col-resize outline-none hover:bg-primary/10 focus-visible:bg-primary/10 active:bg-primary/20 max-lg:hidden"
    >
      <SplitHandleChrome
        onNudge={(direction) =>
          onWidth(getWidth() + direction * 48 * (side === 'left' ? 1 : -1))
        }
      />
    </div>
  )
}
