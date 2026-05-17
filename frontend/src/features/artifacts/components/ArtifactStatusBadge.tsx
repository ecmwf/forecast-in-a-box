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
 * Artifact status badge — Downloaded / Downloading (pulsing, with %) / Not
 * Downloaded. Built on the shared `StatusBadge`.
 */

import { useTranslation } from 'react-i18next'
import type { StatusBadgeVariant } from '@/components/common/StatusBadge'
import {
  STATUS_BADGE_VARIANTS,
  StatusBadge,
} from '@/components/common/StatusBadge'

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

  // Downloading state takes priority.
  if (downloadProgress !== undefined) {
    return (
      <StatusBadge
        variant={{
          label: t('status.downloading', {
            progress: Math.round(downloadProgress),
          }),
          ...STATUS_BADGE_VARIANTS.available,
        }}
        pulse
        className={className}
      />
    )
  }

  const variant: StatusBadgeVariant = isAvailable
    ? { label: t('status.downloaded'), ...STATUS_BADGE_VARIANTS.active }
    : { label: t('status.notDownloaded'), ...STATUS_BADGE_VARIANTS.warning }

  return <StatusBadge variant={variant} className={className} />
}
