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
 * EmptyState Component
 *
 * Displays a message when there's no content to show
 */

import type { ReactNode } from 'react'
import { H3, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  /** Title of the empty state */
  title: string
  /** Description text */
  description?: string
  /** Optional icon */
  icon?: ReactNode
  /** Optional action button */
  action?: {
    label: string
    onClick: () => void
  }
}

/**
 * Empty state component for when there's no data to display
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <H3 className="text-lg font-semibold">{title}</H3>
      {description && (
        <P className="mt-2 text-muted-foreground">{description}</P>
      )}
      {action && (
        <Button onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  )
}
