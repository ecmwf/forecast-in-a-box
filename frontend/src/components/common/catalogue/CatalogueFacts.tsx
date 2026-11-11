/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A catalogue item's facts as labelled values in a wrapping row. */
export function CatalogueFacts({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <dl className={cn('flex flex-wrap gap-x-6 gap-y-2', className)}>
      {children}
    </dl>
  )
}

/** One labelled value inside `CatalogueFacts`. */
export function CatalogueFact({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}
