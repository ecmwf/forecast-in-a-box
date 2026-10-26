/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Icon before a per-layer control; the tooltip names and explains it. */

import type { LucideIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function LayerControlLabel({
  icon: Icon,
  label,
  help,
  helpAria,
}: {
  icon: LucideIcon
  label: string
  help: string
  helpAria: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={helpAria}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        <p className="font-medium">{label}</p>
        <p>{help}</p>
      </TooltipContent>
    </Tooltip>
  )
}
