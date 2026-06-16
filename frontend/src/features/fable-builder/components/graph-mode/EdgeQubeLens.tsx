/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo, useMemo, useState } from 'react'
import { Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { QubeInspector } from './QubeInspector'
import type { QubeNode } from '@/api/types/artifacts.types'
import type { BlockInstance, FableBuilderV1 } from '@/api/types/fable.types'
import { computeQubeMetrics } from '@/features/fable-builder/lib/qube-metrics'
import { computeEdgeNarrowing } from '@/features/fable-builder/lib/qube-narrowing'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Popover side per layout direction — mirrors AddNodeButton so the panel opens
 *  away from the flow rather than over the next block. */
const POPOVER_SIDE: Record<string, 'top' | 'bottom' | 'left' | 'right'> = {
  TB: 'bottom',
  LR: 'right',
  BT: 'top',
  RL: 'left',
}

/** Short human label for a block: "Select <dim>" for selects, else the factory
 *  id de-camel-cased (no catalogue needed). */
function describeBlock(fable: FableBuilderV1, blockId: string): string {
  const block = fable.blocks[blockId] as BlockInstance | undefined
  if (!block) return blockId
  const factory = block.factory_id.factory
  if (factory === 'select') {
    const dimension = block.configuration_values['dimension'] as
      | string
      | undefined
    return dimension != null && dimension !== ''
      ? `Select ${dimension}`
      : 'Select'
  }
  const words = factory
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface EdgeQubeLensProps {
  sourceId: string
  targetId: string
  inputName: string
  /** The wire is hovered (or otherwise emphasised) — emphasises the handle. */
  hovered: boolean
}

/**
 * The qube-lens handle on an edge midpoint: a chip with the qube's
 * dimensionality (and a dot when an upstream Select narrowed it). Clicking opens
 * the inspector. Renders nothing when the backend provides no qube for the edge.
 */
export const EdgeQubeLens = memo(function ({
  sourceId,
  targetId,
  hovered,
}: EdgeQubeLensProps) {
  const { t } = useTranslation('configure')
  const [open, setOpen] = useState(false)
  const layoutDirection = useFableBuilderStore((store) => store.layoutDirection)
  const fable = useFableBuilderStore((store) => store.fable)
  const blockOutputQubes = useFableBuilderStore(
    (store) => store.validationState?.blockOutputQubes,
  )
  // The qube on this edge is the source block's output cube.
  const qube = blockOutputQubes
    ? (blockOutputQubes[sourceId] as QubeNode | undefined)
    : undefined

  const dimensionCount = useMemo(
    () => (qube ? computeQubeMetrics(qube).dimensionCount : 0),
    [qube],
  )
  const narrowing = useMemo(
    () =>
      qube && blockOutputQubes
        ? computeEdgeNarrowing(fable, blockOutputQubes, sourceId)
        : [],
    [qube, blockOutputQubes, fable, sourceId],
  )
  const edgeLabel = useMemo(
    () =>
      `${describeBlock(fable, sourceId)} → ${describeBlock(fable, targetId)}`,
    [fable, sourceId, targetId],
  )

  // No backend qube for this edge → nothing to show.
  if (!qube) return null

  const active = hovered || open
  const narrowed = narrowing.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Subtle handle: dimensionality only; the rich view lives in the popover. */}
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t('qubeLens.handleLabel')}
            className={cn(
              'nodrag nopan inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
              'text-[0.65rem] leading-none font-medium transition-all',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active
                ? 'border-border bg-background text-muted-foreground shadow-sm'
                : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground',
            )}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <Boxes className="size-3 shrink-0" />
        {dimensionCount > 0 && (
          <span className="font-mono">
            {t('qubeLens.dimensionCount', { count: dimensionCount })}
          </span>
        )}
        {narrowed && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            aria-hidden
          />
        )}
      </PopoverTrigger>

      <PopoverContent
        className="max-h-[30rem] w-[min(24rem,90vw)] overflow-y-auto"
        side={POPOVER_SIDE[layoutDirection]}
        align="center"
        sideOffset={10}
        onClick={(event) => event.stopPropagation()}
      >
        <QubeInspector
          node={qube}
          narrowing={narrowing}
          edgeLabel={edgeLabel}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
})
