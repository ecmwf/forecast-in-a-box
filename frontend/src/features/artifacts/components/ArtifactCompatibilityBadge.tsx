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
 * Marks whether a model runs on the local platform — green/amber, with the
 * backend's full reason as a hover tooltip. Shared by the card and table views.
 */

import { useTranslation } from 'react-i18next'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import { cn } from '@/lib/utils'

interface ArtifactCompatibilityBadgeProps {
  artifact: ArtifactInfo
  className?: string
}

export function ArtifactCompatibilityBadge({
  artifact,
  className,
}: ArtifactCompatibilityBadgeProps) {
  const { t } = useTranslation('artifacts')
  const { isLocallyCompatible, localCompatibilityDetail } = artifact

  return (
    <span
      title={
        !isLocallyCompatible && localCompatibilityDetail
          ? t('compatibility.notCompatibleDetail', {
              detail: localCompatibilityDetail,
            })
          : undefined
      }
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-sm font-medium',
        isLocallyCompatible
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
        className,
      )}
    >
      {isLocallyCompatible
        ? t('compatibility.compatible')
        : t('compatibility.notCompatible')}
    </span>
  )
}
