/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Fragment } from 'react'
import type { ReactElement } from 'react'
import type { ValueLabel } from '@/features/fable-builder/hooks/useConfigValueLabels'
import { formatParamDisplay } from '@/components/base/fields/param-display'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** Hover body: each param's label, or the model name and wire id. */
export function ValueLabelDetails({ label }: { label: ValueLabel }) {
  return (
    <span className="flex flex-col gap-2">
      {label.params ? (
        // Grid keeps the ids in one right-aligned column.
        <span className="grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1">
          {label.params.map(({ id, display }) => (
            <Fragment key={id}>
              <span>{formatParamDisplay(display)}</span>
              <span className="text-right text-muted-foreground tabular-nums">
                {id}
              </span>
            </Fragment>
          ))}
        </span>
      ) : (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{label.full}</span>
          <span className="font-mono text-muted-foreground">{label.value}</span>
        </span>
      )}
    </span>
  )
}

/** Hover with a labelled value's details; unlabelled values render bare. */
export function ValueLabelHint({
  label,
  children,
}: {
  label: ValueLabel | undefined
  children: ReactElement
}) {
  if (label === undefined) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top" sideOffset={6}>
        <ValueLabelDetails label={label} />
      </TooltipContent>
    </Tooltip>
  )
}
