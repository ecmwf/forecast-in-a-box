/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Placeholder for an empty list — icon, title, optional description and action. */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { P } from '@/components/base/typography'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground">
      <Icon className="h-10 w-10 text-muted-foreground/50" />
      <div className="space-y-1">
        <P className="font-medium text-foreground">{title}</P>
        {description && <P className="text-sm">{description}</P>}
      </div>
      {action}
    </div>
  )
}
