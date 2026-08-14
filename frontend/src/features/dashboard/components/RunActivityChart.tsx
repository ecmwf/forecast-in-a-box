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
 * The bar chart for `RunActivityPopover`. Split out so the charts vendor
 * chunk is only fetched when the popover opens, not in the dashboard chunk.
 */

import { useMemo } from 'react'
import { barY, crosshair, defineChart } from '@tanstack/charts'
import { motion } from '@tanstack/charts/motion'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { RendererChart } from '@tanstack/react-charts/tooltip'

/** One bucket per month: `month` label and forecast `count`. */
interface MonthBucket {
  month: string
  count: number
}

interface RunActivityChartProps {
  data: Array<MonthBucket>
  /** Accessible series name for the bar. */
  seriesName: string
}

const BAR_COLOR = '#10b981'
const SPRING = {
  type: 'spring' as const,
  stiffness: 210,
  damping: 24,
  mass: 0.78,
}

export default function RunActivityChart({
  data,
  seriesName,
}: RunActivityChartProps) {
  // The host diffs by definition identity — rebuild only when inputs change.
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(data, {
            id: 'activity',
            key: 'month',
            x: 'month',
            y: 'count',
            fill: 'url(#activity-bars)',
            radius: 4,
            inset: 2,
            states: [
              {
                when: { focus: 'unmatched' },
                style: { opacity: 0.3 },
                transition: SPRING,
              },
              {
                when: { focus: 'primary' },
                style: { opacity: 1, inset: 1 },
                transition: SPRING,
              },
            ],
          }),
          // Hover ring around the focused month's band.
          crosshair<string, number>({
            id: 'activity-ring',
            x: {
              band: {
                inset: -2,
                radius: 6,
                fill: 'transparent',
                stroke: BAR_COLOR,
                strokeOpacity: 0.9,
                strokeWidth: 1.5,
              },
            },
            y: false,
            motion: { transition: SPRING },
          }),
        ],
        x: {
          scale: () => scaleBand<string>().paddingInner(0.25).paddingOuter(0.1),
          // No axis line, no tick stubs — month labels only.
          axis: {
            line: false,
            ticks: { size: 0, padding: 6 },
            tickLabels: { fontSize: 11, opacity: 0.7 },
          },
        },
        y: { scale: scaleLinear, grid: true, axis: false },
        gradients: [
          {
            id: 'activity-bars',
            x1: 0,
            y1: 1,
            x2: 0,
            y2: 0,
            stops: [
              { offset: 0, color: BAR_COLOR, opacity: 0.45 },
              { offset: 1, color: BAR_COLOR, opacity: 0.95 },
            ],
          },
        ],
        motion: { transition: SPRING },
        focus: 'nearest',
        tooltip: {
          use: tooltip,
          anchor: 'point',
          placement: ['top', 'right', 'left'],
          className: 'run-activity-tooltip',
          format: ({ datum }) =>
            `${datum.month} · ${datum.count} ${seriesName.toLocaleLowerCase()}`,
        },
      }),
    [data, seriesName],
  )

  const renderer = useMemo(() => motion<MonthBucket, string, number>(), [])

  return (
    <div className="h-36 w-full text-xs text-muted-foreground">
      <RendererChart
        definition={definition}
        renderer={renderer}
        ariaLabel={seriesName}
        height={144}
      />
    </div>
  )
}
