/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Handle } from '@xyflow/react'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

export function BaseHandle({
  className,
  children,
  ...props
}: ComponentProps<typeof Handle>) {
  return (
    <Handle
      {...props}
      className={cn(
        'h-2.75 w-2.75 rounded-full border border-slate-300 bg-slate-100 transition dark:border-slate-600 dark:bg-secondary',
        className,
      )}
    >
      {children}
    </Handle>
  )
}
