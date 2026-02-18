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
 * SourceStatusBadge Component
 *
 * Visual badge for source status
 */

import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Settings,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SourceStatus } from '@/api/types/sources.types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SourceStatusBadgeProps {
  status: SourceStatus
  downloadProgress?: number
}

const statusConfig: Record<
  SourceStatus,
  {
    icon: typeof CheckCircle
    className: string
  }
> = {
  ready: {
    icon: CheckCircle,
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
  },
  available: {
    icon: AlertCircle,
    className: 'bg-muted text-muted-foreground border',
  },
  downloading: {
    icon: Loader2,
    className:
      'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-100 dark:border-blue-900/30',
  },
  configuring: {
    icon: Settings,
    className:
      'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/30',
  },
  error: {
    icon: XCircle,
    className:
      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  },
  disabled: {
    icon: XCircle,
    className: 'bg-muted text-muted-foreground/70 border',
  },
}

export function SourceStatusBadge({
  status,
  downloadProgress,
}: SourceStatusBadgeProps) {
  const { t } = useTranslation('sources')
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn('gap-1.5', config.className)}>
      <Icon
        className={cn('h-3 w-3', status === 'downloading' && 'animate-spin')}
      />
      {status === 'downloading' && downloadProgress !== undefined
        ? t('card.downloadProgress', { progress: Math.round(downloadProgress) })
        : t(`status.${status}`)}
    </Badge>
  )
}
