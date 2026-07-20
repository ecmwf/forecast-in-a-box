/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { P } from '@/components/base/typography'

// Hover-popover close delay — lets the cursor travel trigger→content.
const LEGEND_HOVER_CLOSE_MS = 200

/**
 * Sidebar-thumbnail of a layer legend with a pop-out hover-zoom. Hover
 * reveals a full-size copy in a popover anchored to the right of the
 * sidebar; the close timer lets the cursor travel between trigger and
 * content without flicker. Pinning lives one level up — the parent renders
 * a Pin button next to this thumbnail and a `PinnedLegendsBar` at the
 * bottom of the map for side-by-side comparison.
 */
export function LegendImage({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation('executions')
  const [hovered, setHovered] = useState(false)
  // Servers sometimes advertise legends their endpoint then 500s on.
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  const closeTimer = useRef<number | null>(null)

  const cancelTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const enter = useCallback(() => {
    cancelTimer()
    setHovered(true)
  }, [cancelTimer])
  const leave = useCallback(() => {
    cancelTimer()
    closeTimer.current = window.setTimeout(() => {
      setHovered(false)
      closeTimer.current = null
    }, LEGEND_HOVER_CLOSE_MS)
  }, [cancelTimer])
  useEffect(() => () => cancelTimer(), [cancelTimer])

  if (failed) {
    return (
      <P className="text-xs text-muted-foreground/70 italic">
        {t('lens.legendUnavailable')}
      </P>
    )
  }

  return (
    <Popover
      open={hovered}
      onOpenChange={(o) => {
        if (!o) {
          cancelTimer()
          setHovered(false)
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            onMouseEnter={enter}
            onMouseLeave={leave}
            className="block w-full cursor-zoom-in rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <img
          src={url}
          alt={`${title} legend`}
          // Cap to the box but never upscale — small icon legends blur when stretched full-width.
          className="max-h-32 max-w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        sideOffset={12}
        align="start"
        className="w-auto max-w-2xl p-2"
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <img
          src={url}
          alt={`${title} legend`}
          className="h-auto max-h-[70vh] w-auto max-w-[640px] object-contain"
          loading="lazy"
        />
      </PopoverContent>
    </Popover>
  )
}
