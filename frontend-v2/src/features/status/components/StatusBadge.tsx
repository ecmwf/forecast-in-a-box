/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * StatusBadge component
 * Displays a colored badge based on the status value
 */

import { useTranslation } from 'react-i18next'
import type { StatusValue } from '@/types/status.types'
import { Badge } from '@/components/ui/badge'

interface StatusBadgeProps {
  status: StatusValue
  className?: string
}

/**
 * Get badge variant based on status value
 */
function getStatusVariant(
  status: StatusValue,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status.toLowerCase()) {
    case 'up':
      return 'default' // Will be styled green
    case 'down':
      return 'destructive' // Red
    case 'off':
      return 'secondary' // Gray
    default:
      return 'outline' // Yellow/warning for unknown states
  }
}

/**
 * Get custom color classes based on status
 */
function getStatusColorClass(status: StatusValue): string {
  switch (status.toLowerCase()) {
    case 'up':
      return 'bg-green-500 hover:bg-green-600 text-white'
    case 'down':
      return 'bg-red-500 hover:bg-red-600 text-white'
    case 'off':
      return 'bg-gray-500 hover:bg-gray-600 text-white'
    default:
      return 'bg-yellow-500 hover:bg-yellow-600 text-white'
  }
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation()
  const variant = getStatusVariant(status)
  const colorClass = getStatusColorClass(status)

  // Get translated status text
  const normalizedStatus = status.toLowerCase()
  let displayText: string

  switch (normalizedStatus) {
    case 'up':
      displayText = t('status.status.up')
      break
    case 'down':
      displayText = t('status.status.down')
      break
    case 'off':
      displayText = t('status.status.off')
      break
    default:
      // Fallback to uppercase for unknown statuses
      displayText = status.toUpperCase()
  }

  return (
    <Badge variant={variant} className={`${colorClass} ${className || ''}`}>
      {displayText}
    </Badge>
  )
}
