/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A small chip shared by journal run rows and preset rows. */

import { cn } from '@/lib/utils'

/**
 * `facet` — a derived model/output value (filled, muted). `tag` — a user tag
 * (outlined). When `onClick` is set the chip becomes a button.
 */
export function JournalChip({
  label,
  variant,
  onClick,
}: {
  label: string
  variant: 'facet' | 'tag'
  onClick?: () => void
}) {
  const className = cn(
    'rounded px-2 py-0.5 text-sm transition-colors',
    variant === 'facet'
      ? 'bg-muted text-muted-foreground'
      : 'border border-border bg-card text-muted-foreground',
    onClick && 'cursor-pointer hover:text-foreground',
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {label}
      </button>
    )
  }
  return <span className={className}>{label}</span>
}
