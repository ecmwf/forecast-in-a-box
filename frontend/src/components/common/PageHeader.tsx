/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * PageHeader Component
 *
 * Consistent page header with title, description, and optional actions
 */

import type { ReactNode } from 'react'
import { H1, P } from '@/components/base/typography'

interface PageHeaderProps {
  /** Page title */
  title: string
  /** Optional description */
  description?: string
  /** Optional action buttons */
  actions?: ReactNode
}

/**
 * Page header component for consistent page layouts
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <H1>{title}</H1>
        {description && <P className="text-muted-foreground">{description}</P>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}
