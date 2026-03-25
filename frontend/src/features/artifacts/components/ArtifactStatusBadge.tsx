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
 * ArtifactStatusBadge Component
 *
 * Displays a status badge for an artifact model.
 * - Downloaded (green): model is available locally
 * - Downloading (blue, pulsing): download in progress, shows percentage
 * - Not Downloaded (amber): model needs to be downloaded
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface ArtifactStatusBadgeProps {
  isAvailable: boolean
  /** If set, shows a "Downloading X%" badge instead of the static status */
  downloadProgress?: number
  className?: string
}

export function ArtifactStatusBadge({
  isAvailable,
  downloadProgress,
  className,
}: ArtifactStatusBadgeProps) {
  const { t } = useTranslation('artifacts')

  // Downloading state takes priority
  if (downloadProgress !== undefined) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium',
          'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
          className,
        )}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
        {t('status.downloading', { progress: Math.round(downloadProgress) })}
      </span>
    )
  }

  const config = isAvailable
    ? {
        label: t('status.downloaded'),
        dotClass: 'bg-emerald-500',
        badgeClass:
          'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
      }
    : {
        label: t('status.notDownloaded'),
        dotClass: 'bg-amber-500',
        badgeClass:
          'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800',
      }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium',
        config.badgeClass,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  )
}
