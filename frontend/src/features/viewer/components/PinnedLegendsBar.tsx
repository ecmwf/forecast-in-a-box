/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { PinOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { rebaseLensUrl } from '../wms-capabilities'
import type { ParsedLayer } from '../wms-capabilities'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

/**
 * Floating strip at the bottom of the map area listing every legend the
 * user has pinned. Responsive grid: 1 / 2 / 3 columns based on viewport
 * width so a wide screen can show three legends side-by-side. Each card
 * shows the layer title, the legend image, and an unpin button.
 */
export function PinnedLegendsBar({
  baseUrl,
  layers,
  pinnedLegends,
  onUnpin,
}: {
  baseUrl: string
  layers: ReadonlyArray<ParsedLayer>
  pinnedLegends: ReadonlySet<string>
  onUnpin: (name: string) => void
}) {
  const { t } = useTranslation('executions')
  const items = Array.from(pinnedLegends).flatMap((name) => {
    const layer = layers.find((l) => l.name === name)
    const legendUrl = layer?.styles[0]?.legendUrl
    if (!layer || !legendUrl) return []
    return [{ layer, legendUrl: rebaseLensUrl(legendUrl, baseUrl) }]
  })
  if (items.length === 0) return null
  // Pick column count to match item count exactly (so the strip always
  // fills the row), capped at 3 on very wide screens. Special case: 4
  // items become 2×2 instead of 3+1, which the user explicitly preferred
  // over an unbalanced last row. With a single legend we cap the grid to
  // a narrower width and centre it — full-width-with-aspect-ratio makes
  // the card unnecessarily tall.
  const gridClass =
    items.length === 1
      ? 'grid-cols-1 sm:max-w-md sm:mx-auto'
      : items.length === 2 || items.length === 4
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 max-h-[45%] overflow-y-auto">
      <div className="pointer-events-auto m-3">
        <div className={cn('grid gap-2', gridClass)}>
          {items.map(({ layer, legendUrl }) => (
            <div
              key={layer.name}
              className="flex items-start gap-2 rounded border border-border bg-card px-2 py-2"
            >
              <div className="min-w-0 flex-1">
                <P className="truncate text-xs font-medium" title={layer.title}>
                  {layer.title}
                </P>
                <img
                  src={legendUrl}
                  alt={`${layer.title} legend`}
                  className="mt-1 h-auto max-h-40 w-full object-contain"
                  loading="lazy"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => onUnpin(layer.name)}
                aria-label={t('lens.unpinLegend')}
                title={t('lens.unpinLegend')}
              >
                <PinOff className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
