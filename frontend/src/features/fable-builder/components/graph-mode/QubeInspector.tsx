/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { QubeSpectrum } from './QubeSpectrum'
import type { QubeNode } from '@/api/types/artifacts.types'
import type { QubeDimension } from '@/features/fable-builder/lib/qube-matrix'
import type { DimensionNarrowing } from '@/features/fable-builder/lib/qube-narrowing'
import {
  computeQubeMetrics,
  formatBytes,
} from '@/features/fable-builder/lib/qube-metrics'
import { dimensionColor } from '@/features/fable-builder/lib/dimension-colors'
import { qubeToRequest } from '@/features/fable-builder/lib/qube-to-request'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type Tab = 'dimensions' | 'selection'

function ColorDot({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: dimensionColor(name) }}
    />
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xl leading-none font-semibold text-foreground">
        {value}
      </span>
      <span className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  )
}

function DimensionRow({
  dim,
  narrowing,
  highlighted,
  search,
}: {
  dim: QubeDimension
  narrowing: DimensionNarrowing | undefined
  highlighted: boolean
  search: string
}) {
  const { t } = useTranslation('configure')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  const count = dim.values.length
  const fixedValue = count === 1 ? dim.values[0] : null
  // Auto-reveal a dimension's values when the search matches one of them.
  const valueMatch =
    search !== '' &&
    dim.values.some((value) => value.toLowerCase().includes(search))
  const showValues = open || valueMatch

  // Selecting this dimension's spectrum bar reveals and scrolls to its row.
  useEffect(() => {
    if (highlighted) {
      setOpen(true)
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  return (
    <li ref={ref} className={cn('rounded', highlighted && 'bg-primary/5')}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex w-full items-center gap-2 rounded px-1 py-1.5 text-left transition-colors hover:bg-muted/50',
          highlighted && 'ring-2 ring-primary/40',
        )}
      >
        <ColorDot name={dim.key} />
        <span className="font-mono text-sm font-medium text-foreground">
          {dim.key}
        </span>
        {fixedValue != null && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {fixedValue}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {narrowing != null && (
            <Badge
              variant="outline"
              className="border-primary/40 text-[0.6rem] tracking-wide text-primary uppercase"
            >
              {t('qubeLens.narrowedBadge')}
            </Badge>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {count}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              showValues && 'rotate-180',
            )}
          />
        </span>
      </button>
      {showValues && count > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-1 pb-2">
          {dim.values.map((value) => {
            const isMatch =
              search !== '' && value.toLowerCase().includes(search)
            return (
              <Badge
                key={value}
                variant="secondary"
                className={cn(
                  'font-mono',
                  isMatch &&
                    'border border-primary/50 bg-primary/10 text-primary',
                )}
              >
                {value}
              </Badge>
            )
          })}
        </div>
      )}
    </li>
  )
}

/**
 * "Qube at this edge" inspector: stats, the interactive spectrum, the upstream
 * narrowing diff, a searchable dimension list, and a source-neutral selection
 * view. Clicking a spectrum bar jumps to that dimension's row.
 */
export function QubeInspector({
  node,
  narrowing,
  edgeLabel,
  onClose,
}: {
  node: QubeNode
  narrowing: ReadonlyArray<DimensionNarrowing>
  edgeLabel?: string
  onClose?: () => void
}) {
  const { t } = useTranslation('configure')
  const [tab, setTab] = useState<Tab>('dimensions')
  const [query, setQuery] = useState('')
  const [hideFixed, setHideFixed] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const metrics = useMemo(() => computeQubeMetrics(node), [node])
  const narrowingByDim = useMemo(
    () => new Map(narrowing.map((item) => [item.dimension, item])),
    [narrowing],
  )

  const hasFixed = metrics.dimensions.some((dim) => dim.values.length <= 1)
  const search = query.trim().toLowerCase()
  // Most-varying dimensions first, then alphabetical — the qube's tree order
  // reads as arbitrary, and this sinks the size-1 context dims to the bottom.
  const visibleDimensions = metrics.dimensions
    .filter((dim) => {
      if (hideFixed && dim.values.length <= 1) return false
      if (search === '') return true
      // Match the axis name or any of its coordinate values.
      return (
        dim.key.toLowerCase().includes(search) ||
        dim.values.some((value) => value.toLowerCase().includes(search))
      )
    })
    .sort(
      (a, b) => b.values.length - a.values.length || a.key.localeCompare(b.key),
    )

  const selectDimension = (key: string) => {
    // Toggle: clicking the already-selected bar deselects it and scrolls back up.
    if (highlighted === key) {
      setHighlighted(null)
      rootRef.current?.scrollIntoView({ block: 'start' })
      return
    }
    setTab('dimensions')
    setQuery('')
    setHideFixed(false)
    setHighlighted(key)
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">
            {t('qubeLens.title')}
          </span>
          {edgeLabel != null && edgeLabel !== '' && (
            <span className="font-mono text-xs text-muted-foreground">
              {edgeLabel}
            </span>
          )}
        </div>
        {onClose != null && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('qubeLens.close')}
            className="-mt-1 -mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          value={t('qubeLens.dimensionCount', {
            count: metrics.dimensionCount,
          })}
          label={t('qubeLens.statDimensions')}
        />
        <Stat
          value={metrics.fieldCount.toLocaleString()}
          label={t('qubeLens.statFields')}
        />
        <Stat
          value={`≈ ${formatBytes(metrics.estimatedBytes)}`}
          label={t('qubeLens.statSize')}
        />
      </div>

      <div className="flex justify-center py-1">
        <QubeSpectrum
          dimensions={metrics.dimensions}
          size="lg"
          onBarClick={selectDimension}
          activeKey={highlighted}
        />
      </div>

      {narrowing.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          {narrowing.map((item) => (
            <div
              key={item.dimension}
              className="flex items-center gap-2 text-sm"
            >
              <ColorDot name={item.dimension} />
              <span className="font-mono font-medium text-foreground">
                {item.dimension}
              </span>
              <span className="text-muted-foreground">
                {t('qubeLens.narrowedDiff', {
                  from: item.from,
                  to: item.to,
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
        {(['dimensions', 'selection'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={cn(
              'flex-1 rounded px-2 py-1 transition-colors',
              tab === option
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option === 'dimensions'
              ? t('qubeLens.tabDimensions')
              : t('qubeLens.tabSelection')}
          </button>
        ))}
      </div>

      {tab === 'dimensions' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('qubeLens.searchPlaceholder')}
              className="h-8"
            />
            {hasFixed && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  size="sm"
                  checked={hideFixed}
                  onCheckedChange={setHideFixed}
                />
                {t('qubeLens.hideFixed')}
              </label>
            )}
          </div>

          <ul className="flex flex-col">
            {visibleDimensions.map((dim) => (
              <DimensionRow
                key={dim.key}
                dim={dim}
                narrowing={narrowingByDim.get(dim.key)}
                highlighted={highlighted === dim.key}
                search={search}
              />
            ))}
          </ul>

          <div className="border-t border-border pt-2 text-center font-mono text-xs text-muted-foreground">
            {metrics.dimensions.map((dim) => dim.values.length).join(' × ')} ={' '}
            <span className="font-semibold text-foreground">
              {metrics.fieldCount.toLocaleString()}
            </span>{' '}
            {t('qubeLens.fieldsUnit')}
          </div>
        </div>
      ) : (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs text-foreground">
          {qubeToRequest(node) || t('qubeLens.requestEmpty')}
        </pre>
      )}
    </div>
  )
}
