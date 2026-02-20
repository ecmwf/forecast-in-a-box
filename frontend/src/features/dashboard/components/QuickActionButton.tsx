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
 * QuickActionButton Component
 *
 * Action button for the welcome card
 */

import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface QuickActionButtonProps {
  icon: ReactNode
  label: string
  to?: string
  onClick?: () => void
  className?: string
}

export function QuickActionButton({
  icon,
  label,
  to,
  onClick,
  className,
}: QuickActionButtonProps) {
  const baseClasses = cn(
    'flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg',
    'border border-border',
    'hover:bg-muted transition-colors',
    'text-sm font-medium',
    className,
  )

  if (to) {
    return (
      <Link to={to} className={baseClasses}>
        {icon}
        {label}
      </Link>
    )
  }

  return (
    <button onClick={onClick} className={baseClasses}>
      {icon}
      {label}
    </button>
  )
}
