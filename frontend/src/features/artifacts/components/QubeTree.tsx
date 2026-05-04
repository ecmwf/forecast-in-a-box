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
 * QubeTree
 *
 * Renders a Qube — a compressed tree of `key=value` pairs (per the qubed
 * datacube spec) — to the user. Auto-dispatches based on shape:
 *
 *   - **AIFS-shaped** (top-level branches are `levtype` with `param`
 *     children and optional `level` grandchildren): the dimensional matrix
 *     view, with a pivot toggle.
 *   - **Anything else**: a generic compressed-tree view mirroring the
 *     canonical text output of `qubed.compress()` — chains of
 *     single-child nodes are flattened onto one line as
 *     `key=v1/v2/v3, key=v1/v2`, branching only where the qube actually
 *     branches.
 */

import { ChevronDown } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { QubeNode } from '@/api/types/artifacts.types'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

export interface QubeTreeProps {
  node: QubeNode
  className?: string
}

interface MatrixSection {
  /** Stable key for React lists. */
  id: string
  /** Original levtype value (e.g. "pl", "sfc"). */
  levtype: string
  /** Display title (e.g. "Pressure Levels (PL)"). */
  title: string
  /** Parameters in the order they appear in the qube. */
  params: Array<string>
  /**
   * Levels in altitude-ascending order (high pressure first → low pressure
   * last). null if the branch has no level dimension (e.g. surface).
   */
  levels: Array<number> | null
  /** Set of "param|level" strings for fast presence lookup. */
  presence: Set<string>
}

export function QubeTree({ node, className }: QubeTreeProps) {
  const { t } = useTranslation('artifacts')
  const [pivoted, setPivoted] = useState(false)
  const switchId = useId()

  if (node.children.length === 0) {
    return (
      <P className="text-sm text-muted-foreground">
        {t('detail.noOutputStructure')}
      </P>
    )
  }

  // Matrix view only makes sense when the qube has the AIFS-style param
  // (and optional level) dimensions. Anything else falls through to the
  // generic compressed-tree view.
  if (isAifsShaped(node)) {
    return (
      <AifsMatrixView
        node={node}
        pivoted={pivoted}
        switchId={switchId}
        onPivotChange={setPivoted}
        className={className}
      />
    )
  }

  return <GenericTreeView node={node} className={className} />
}

function AifsMatrixView({
  node,
  pivoted,
  switchId,
  onPivotChange,
  className,
}: {
  node: QubeNode
  pivoted: boolean
  switchId: string
  onPivotChange: (next: boolean) => void
  className?: string
}) {
  const { t } = useTranslation('artifacts')
  const sections = useMemo(() => processQube(node), [node])
  const hasMatrixSection = sections.some((s) => s.levels !== null)

  return (
    <Card shadow="none" className={cn('space-y-2 p-5', className)}>
      <header className="flex items-center justify-between gap-4">
        <P className="font-mono text-xs font-semibold tracking-wider text-foreground uppercase">
          {t('detail.qubeMatrixTitle')}
        </P>
        {hasMatrixSection ? (
          <label
            htmlFor={switchId}
            className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
          >
            <span>{t('detail.qubePivotLabel')}</span>
            <Switch
              id={switchId}
              size="sm"
              checked={pivoted}
              onCheckedChange={onPivotChange}
            />
          </label>
        ) : null}
      </header>

      <div className="space-y-4">
        {sections.map((section) => (
          <SectionView key={section.id} section={section} pivoted={pivoted} />
        ))}
      </div>
    </Card>
  )
}

/**
 * Compressed-tree renderer for any qube. Mirrors `qubed.compress()` text
 * output: walks single-child chains and concatenates them as
 * `key=v1/v2, key=v1/v2/v3`, branching only where the qube actually
 * branches. Uses ASCII box-drawing for connectors.
 */
function GenericTreeView({
  node,
  className,
}: {
  node: QubeNode
  className?: string
}) {
  const { t } = useTranslation('artifacts')
  return (
    <Card shadow="none" className={cn('space-y-2 p-5', className)}>
      <P className="font-mono text-xs font-semibold tracking-wider text-foreground uppercase">
        {t('detail.qubeTreeTitle')}
      </P>
      <pre className="overflow-x-auto pt-1 font-mono text-xs leading-6 text-foreground">
        <code>
          <span className="text-muted-foreground">root</span>
          {'\n'}
          {node.children.map((child, idx) => (
            <TreeRow
              key={`${child.key}-${idx}`}
              node={child}
              prefix=""
              isLast={idx === node.children.length - 1}
            />
          ))}
        </code>
      </pre>
    </Card>
  )
}

function TreeRow({
  node,
  prefix,
  isLast,
}: {
  node: QubeNode
  prefix: string
  isLast: boolean
}) {
  const { chainLabel, terminalChildren } = flattenChain(node)
  const connector = isLast ? '└── ' : '├── '
  const childPrefix = prefix + (isLast ? '    ' : '│   ')

  return (
    <>
      <span className="text-muted-foreground">
        {prefix}
        {connector}
      </span>
      <span>{chainLabel}</span>
      {'\n'}
      {terminalChildren.map((child, idx) => (
        <TreeRow
          key={`${child.key}-${idx}`}
          node={child}
          prefix={childPrefix}
          isLast={idx === terminalChildren.length - 1}
        />
      ))}
    </>
  )
}

/**
 * Walk down the single-child chain starting at `node`, accumulating
 * `key=v1/v2` segments. Stops at the first node with multiple children
 * (or zero children); those are returned as `terminalChildren` for
 * recursive rendering.
 */
function flattenChain(node: QubeNode): {
  chainLabel: string
  terminalChildren: ReadonlyArray<QubeNode>
} {
  const parts = [formatNode(node)]
  let current = node
  while (current.children.length === 1) {
    current = current.children[0]
    parts.push(formatNode(current))
  }
  return { chainLabel: parts.join(', '), terminalChildren: current.children }
}

function formatNode(node: QubeNode): string {
  const values = node.values.values.map(String).join('/')
  return `${node.key}=${values}`
}

/**
 * AIFS shape marker: every top-level branch is keyed on `levtype`. The
 * matrix view's projection (params on one axis, optional levels on the
 * other) is meaningful only when the qube splits at levtype first; any
 * other shape (e.g. `class → expver → param=N`) gets misrendered by the
 * matrix and falls through to the generic compressed-tree view.
 */
function isAifsShaped(root: QubeNode): boolean {
  return (
    root.children.length > 0 &&
    root.children.every((branch) => branch.key === 'levtype')
  )
}

function SectionView({
  section,
  pivoted,
}: {
  section: MatrixSection
  pivoted: boolean
}) {
  const { t } = useTranslation('artifacts')

  const summary =
    section.levels !== null
      ? t('detail.qubeMatrixSize', {
          paramCount: section.params.length,
          levelCount: section.levels.length,
          fieldCount: section.presence.size,
        })
      : t('detail.qubeParamCount', {
          count: section.params.length,
        })

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/50">
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform [[data-panel-closed]_&]:-rotate-90 [[data-panel-open]_&]:rotate-0" />
        <span className="font-mono text-xs font-semibold tracking-wide text-foreground uppercase">
          {section.title}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {summary}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 pl-5">
          {section.levels !== null ? (
            <DimensionalMatrix section={section} pivoted={pivoted} />
          ) : (
            <SurfaceList section={section} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DimensionalMatrix({
  section,
  pivoted,
}: {
  section: MatrixSection
  pivoted: boolean
}) {
  const { t } = useTranslation('artifacts')
  const [hover, setHover] = useState<{ row?: number; col?: number }>({})
  const levels = section.levels ?? []

  // Levels are always sorted descending pressure (1000 hPa → 50 hPa) so the
  // visual alignment of the data is preserved across the pivot — toggling
  // is a pure transpose, not a re-sort.
  const sortedLevels = [...levels].sort((a, b) => b - a)
  const rows = pivoted ? sortedLevels : section.params
  const cols = pivoted ? section.params : sortedLevels

  const formatRow = (value: number | string): string =>
    pivoted ? formatLevel(value as number) : String(value)
  const formatCol = (value: number | string): string =>
    pivoted ? String(value) : formatLevel(value as number)

  const isPresent = (row: number | string, col: number | string): boolean => {
    const param = pivoted ? col : row
    const level = pivoted ? row : col
    return section.presence.has(`${param}|${level}`)
  }

  // CSS Grid keeps the row-label column auto-sized while the data columns
  // share the remaining card width equally, so the matrix always fills its
  // container regardless of axis orientation. Padding lives inside each cell
  // (rather than via grid gap) so the hover crosshair band stays continuous
  // across the whole row / column.
  const gridTemplateColumns = `max-content repeat(${cols.length}, minmax(0, 1fr))`
  const headerCellClasses =
    'px-1 py-1 text-center font-mono text-xs font-medium transition-colors'
  const dataCellClasses =
    'flex items-center justify-center px-1 py-1 transition-colors'

  return (
    <div
      role="table"
      className="grid w-full items-stretch"
      style={{ gridTemplateColumns }}
      onMouseLeave={() => setHover({})}
    >
      <div role="row" className="contents">
        <div
          role="columnheader"
          className="px-1 py-1 pr-3 text-left font-mono text-[10px] font-medium tracking-wider text-muted-foreground/70 uppercase"
        >
          {pivoted ? t('detail.qubeAxisLevel') : t('detail.qubeAxisParam')}
        </div>
        {cols.map((col, colIdx) => (
          <div
            key={String(col)}
            role="columnheader"
            className={cn(
              headerCellClasses,
              hover.col === colIdx
                ? 'rounded-t bg-muted/60 text-foreground'
                : 'text-muted-foreground',
            )}
            onMouseEnter={() => setHover({ col: colIdx })}
          >
            {formatCol(col)}
          </div>
        ))}
      </div>

      {rows.map((row, rowIdx) => (
        <div key={String(row)} role="row" className="contents">
          <div
            role="rowheader"
            className={cn(
              'px-1 py-1 pr-3 text-right font-mono text-xs font-medium transition-colors',
              hover.row === rowIdx
                ? 'rounded-l bg-muted/60 text-foreground'
                : 'text-foreground/80',
            )}
            onMouseEnter={() => setHover({ row: rowIdx })}
          >
            {formatRow(row)}
          </div>
          {cols.map((col, colIdx) => {
            const present = isPresent(row, col)
            const tooltip = pivoted
              ? `${col} @ ${formatLevel(row as number)}`
              : `${row} @ ${formatLevel(col as number)}`
            const inRow = hover.row === rowIdx
            const inCol = hover.col === colIdx
            return (
              <div
                key={String(col)}
                role="cell"
                className={cn(
                  dataCellClasses,
                  (inRow || inCol) && 'bg-muted/40',
                  inRow && inCol && 'bg-muted/70',
                )}
                title={tooltip}
                onMouseEnter={() => setHover({ row: rowIdx, col: colIdx })}
              >
                <Cell present={present} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Cell({ present }: { present: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 rounded-[2px]',
        present
          ? 'bg-primary shadow-[0_0_0_2px_var(--color-primary)]/10'
          : 'border border-muted-foreground/25 bg-transparent',
      )}
    />
  )
}

function SurfaceList({ section }: { section: MatrixSection }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {section.params.map((param) => (
        <Badge
          key={param}
          variant="secondary"
          className="font-mono"
          title={param}
        >
          {param}
        </Badge>
      ))}
    </div>
  )
}

/**
 * Walk the qube and produce one MatrixSection per top-level branch.
 * For each branch, accumulate the (param, level) tuples actually present
 * by visiting every leaf path — this correctly handles the case where
 * different params expose different level subsets.
 */
function processQube(root: QubeNode): Array<MatrixSection> {
  return root.children.map((branch, idx) => {
    const levtype = branch.values.values.map(String).join(',') || branch.key

    const params: Array<string> = []
    const seenParams = new Set<string>()
    const levelsSet = new Set<number>()
    const presence = new Set<string>()

    walkLeaves(branch, {}, (ctx) => {
      const param = 'param' in ctx ? String(ctx.param) : null
      if (param && !seenParams.has(param)) {
        seenParams.add(param)
        params.push(param)
      }
      if ('level' in ctx && param) {
        const level = Number(ctx.level)
        if (!Number.isNaN(level)) {
          levelsSet.add(level)
          presence.add(`${param}|${level}`)
        }
      }
    })

    const levels =
      levelsSet.size > 0 ? [...levelsSet].sort((a, b) => a - b) : null

    return {
      id: `${branch.key}-${branchSlug(branch)}-${idx}`,
      levtype,
      title: sectionTitle(branch),
      params,
      levels,
      presence,
    }
  })
}

/**
 * Visit every leaf below `node`, invoking `visitor` with the cumulative
 * dimension-key → value context. Each value of each dimension creates a
 * new branch in the walk.
 */
function walkLeaves(
  node: QubeNode,
  ctx: Record<string, string | number>,
  visitor: (ctx: Record<string, string | number>) => void,
): void {
  for (const value of node.values.values) {
    const nextCtx = { ...ctx, [node.key]: value }
    if (node.children.length === 0) {
      visitor(nextCtx)
    } else {
      for (const child of node.children) {
        walkLeaves(child, nextCtx, visitor)
      }
    }
  }
}

function sectionTitle(branch: QubeNode): string {
  const name = readMetadataName(branch.metadata)
  const code = branch.values.values.map(String).join(', ')
  if (name) return `${capitalize(name)} levels (${code.toUpperCase()})`
  return `${branch.key} = ${code}`
}

function branchSlug(branch: QubeNode): string {
  return branch.values.values.map(String).join('-') || 'unset'
}

function readMetadataName(metadata: Record<string, unknown>): string | null {
  const name = metadata.name
  if (!name || typeof name !== 'object') return null
  const values = (name as { values?: Array<unknown> }).values
  if (!Array.isArray(values) || values.length === 0) return null
  const first = values[0]
  return typeof first === 'string' ? first : null
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatLevel(level: number): string {
  if (!Number.isFinite(level)) return String(level)
  return `${level} hPa`
}
