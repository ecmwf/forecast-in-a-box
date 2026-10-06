/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import {
  formatParamDisplay,
  paramLabel,
  parseParamDisplay,
} from '@/components/base/fields/param-display'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** Dropdown row for a param id: the label, then the id muted. */
export function ParamOptionLabel({
  id,
  labels,
}: {
  id: string
  labels: ReadonlyMap<string, string>
}) {
  if (!labels.has(id)) return <>{id}</>
  return (
    <>
      <span className="min-w-0 truncate">{paramLabel(id, labels, 'full')}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {id}
      </span>
    </>
  )
}

/** Hover line for a param, like its dropdown row. */
export function ParamHint({ id, display }: { id: string; display: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span>{formatParamDisplay(display)}</span>
      {id !== parseParamDisplay(display).short && (
        <span className="text-muted-foreground tabular-nums">{id}</span>
      )}
    </span>
  )
}

/** Param details on hover; unlabelled ids render bare. */
export function ParamHintTooltip({
  id,
  labels,
  children,
}: {
  id: string
  labels: ReadonlyMap<string, string>
  children: React.ReactElement
}) {
  const display = labels.get(id)
  if (display === undefined) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top" sideOffset={6}>
        <ParamHint id={id} display={display} />
      </TooltipContent>
    </Tooltip>
  )
}

/** Matches by id or any part of the label (name, units, shortname). */
export function matchesParam(
  id: string,
  query: string,
  labels: ReadonlyMap<string, string>,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return id.includes(q) || (labels.get(id)?.toLowerCase().includes(q) ?? false)
}
