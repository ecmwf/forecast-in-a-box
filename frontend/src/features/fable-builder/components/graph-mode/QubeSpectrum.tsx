/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'

import type { QubeDimension } from '@/features/fable-builder/lib/qube-matrix'
import { dimensionColor } from '@/features/fable-builder/lib/dimension-colors'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * One colored bar per dimension, height (log-scaled) = cardinality; colors are
 * shared with the inspector. With `onBarClick`, bars are interactive: hover
 * shows a light tooltip, click selects (`activeKey` bar emphasised, rest fade).
 */

const SIZES = {
  sm: { bar: 3, gap: 1.5, height: 16 },
  lg: { bar: 9, gap: 4, height: 40 },
} as const

/** Smallest bar height fraction, so size-1 dimensions still show a stub. */
const MIN_FRACTION = 0.18

export function QubeSpectrum({
  dimensions,
  size = 'sm',
  className,
  onBarClick,
  activeKey,
}: {
  dimensions: ReadonlyArray<QubeDimension>
  size?: 'sm' | 'lg'
  className?: string
  onBarClick?: (key: string) => void
  activeKey?: string | null
}) {
  const { t } = useTranslation('configure')

  if (dimensions.length === 0) return null

  const metrics = SIZES[size]
  const interactive = onBarClick != null
  const maxCount = Math.max(...dimensions.map((dim) => dim.values.length))
  const denominator = Math.log(maxCount + 1) || 1

  const barHeight = (dim: QubeDimension): number => {
    const fraction =
      MIN_FRACTION +
      (1 - MIN_FRACTION) * (Math.log(dim.values.length + 1) / denominator)
    return Math.max(2, fraction * metrics.height)
  }

  if (!interactive) {
    return (
      <div
        className={cn('flex items-end', className)}
        style={{ gap: metrics.gap, height: metrics.height }}
        role="img"
        aria-label={`Qube spectrum, ${dimensions.length} dimensions`}
      >
        {dimensions.map((dim) => (
          <div
            key={dim.key}
            title={`${dim.key} (${dim.values.length})`}
            className="shrink-0 rounded-[2px]"
            style={{
              width: metrics.bar,
              height: barHeight(dim),
              backgroundColor: dimensionColor(dim.key),
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <TooltipProvider delay={120}>
      <div
        className={cn('flex items-end', className)}
        style={{ gap: metrics.gap, height: metrics.height }}
      >
        {dimensions.map((dim) => {
          const isActive = activeKey != null && dim.key === activeKey
          const dimmed = activeKey != null && !isActive
          return (
            <Tooltip key={dim.key}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${dim.key}: ${dim.values.length}`}
                    onClick={() => onBarClick(dim.key)}
                    className={cn(
                      'shrink-0 cursor-pointer rounded-[2px] transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      dimmed && 'opacity-30',
                    )}
                    style={{
                      width: metrics.bar,
                      height: barHeight(dim),
                      backgroundColor: dimensionColor(dim.key),
                    }}
                  />
                }
              />
              <TooltipContent variant="light" side="top" sideOffset={6}>
                {t('qubeLens.barTooltip', {
                  dimension: dim.key,
                  count: dim.values.length,
                })}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
