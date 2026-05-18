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
 * The recharts bar chart for `RunActivityPopover`. Split out so `recharts`
 * (~300 KB) is only fetched when the popover opens, not in the dashboard chunk.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { Bar, BarChart, Tooltip, XAxis } from 'recharts'

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

export default function RunActivityChart({
  data,
  seriesName,
}: RunActivityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  )

  // Size `BarChart` explicitly from a measured container: `ResponsiveContainer`
  // renders once at -1×-1 before its observer fires, which recharts warns about.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      setSize((prev) =>
        prev && prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="h-36 w-full text-muted-foreground">
      {size && size.width > 0 && size.height > 0 && (
        <BarChart
          width={size.width}
          height={size.height}
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        >
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tick={{ fontSize: 11, fill: 'currentColor' }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              background: 'var(--popover)',
              color: 'var(--popover-foreground)',
              fontSize: '0.75rem',
            }}
          />
          <Bar
            dataKey="count"
            name={seriesName}
            fill="#10b981"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      )}
    </div>
  )
}
