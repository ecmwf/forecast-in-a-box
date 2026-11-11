/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Covers a drop target while a file is dragged over it; the parent must be positioned. */
export function FileDropOverlay({
  label,
  detail,
  className,
}: {
  label: string
  /** A quieter second line, e.g. what happens to current work. */
  detail?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-card/90 text-sm font-medium text-primary',
        className,
      )}
    >
      <FileUp className="h-5 w-5" />
      <span>{label}</span>
      {detail && (
        <span className="text-xs font-normal text-muted-foreground">
          {detail}
        </span>
      )}
    </div>
  )
}
