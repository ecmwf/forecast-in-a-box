/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** A collapsible, counted group of runs in the journal list. */
export function JournalGroup({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-6 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/50">
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')}
        />
        <span>{label}</span>
        <span className="font-normal text-muted-foreground">({count})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
