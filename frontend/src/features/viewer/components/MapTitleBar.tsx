/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { formatStep } from '../format'
import type { ParsedLayer } from '../wms-capabilities'
import { P } from '@/components/base/typography'

/**
 * Compact summary of what's currently on the map: active layer titles,
 * separated by middots, plus the forecast time when one is set. Floats at
 * top-centre of the map so a screenshot/download captures the full context
 * without the user needing to caption it manually.
 */
export function MapTitleBar({
  layers,
  activeOrder,
  activeTime,
}: {
  layers: ReadonlyArray<ParsedLayer>
  activeOrder: ReadonlyArray<string>
  activeTime: string | null
}) {
  const titles = activeOrder
    .map((name) => layers.find((l) => l.name === name)?.title)
    .filter((title): title is string => !!title)
  if (titles.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[60%] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
      <P className="truncate font-medium" title={titles.join(' · ')}>
        {titles.join(' · ')}
      </P>
      {activeTime && (
        <span className="border-l border-border pl-2 font-mono text-muted-foreground tabular-nums">
          {formatStep(activeTime)}
        </span>
      )}
    </div>
  )
}
