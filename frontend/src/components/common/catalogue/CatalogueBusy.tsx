/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CatalogueBusyProps {
  label: string
  /** 0-100; omit for indeterminate. */
  progress?: number
  onCancel?: () => void
  cancelLabel?: string
  className?: string
}

/** In-flight work in the item's action slot; the status badge names it. */
export function CatalogueBusy({
  label,
  progress,
  onCancel,
  cancelLabel,
  className,
}: CatalogueBusyProps) {
  return (
    <div
      role="status"
      className={cn('flex h-9 min-w-0 items-center gap-2', className)}
    >
      <span className="sr-only">{label}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-primary/15">
        {progress !== undefined ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.round(progress)}%` }}
          />
        ) : (
          <div className="h-full w-1/4 animate-[map-loading-sweep_1.1s_linear_infinite] rounded-full bg-primary" />
        )}
      </div>
      {progress !== undefined && (
        <span className="w-9 text-right text-sm text-muted-foreground tabular-nums">
          {Math.round(progress)}%
        </span>
      )}
      {onCancel && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-danger"
          onClick={onCancel}
          aria-label={cancelLabel}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
