/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ArtifactStatusTextProps {
  artifact: Pick<
    ArtifactInfo,
    'isAvailable' | 'isLocallyCompatible' | 'localCompatibilityDetail'
  >
  /** In-flight work, e.g. "Deleting"; progress shows elsewhere. */
  busyLabel?: string
  /** Failure reason, shown on hover. */
  downloadError?: string
}

/** A model's availability on this host as plain text, explained on hover. */
export function ArtifactStatusText({
  artifact,
  busyLabel,
  downloadError,
}: ArtifactStatusTextProps) {
  const { t } = useTranslation('artifacts')

  if (busyLabel !== undefined) {
    return <span className="text-sm text-muted-foreground">{busyLabel}</span>
  }
  if (downloadError !== undefined) {
    return (
      <WithReason reason={downloadError} className="text-danger">
        {t('status.downloadFailed')}
      </WithReason>
    )
  }
  if (!artifact.isLocallyCompatible) {
    const detail = artifact.localCompatibilityDetail
    // Downloaded yet incompatible, e.g. after a catalogue update.
    const reason = artifact.isAvailable
      ? detail === null
        ? t('status.downloadedIncompatible')
        : t('status.downloadedIncompatibleDetail', { detail })
      : (detail ?? t('compatibility.notCompatibleHint'))
    return (
      <WithReason
        reason={reason}
        className="text-amber-700 dark:text-amber-400"
      >
        {t('compatibility.notCompatible')}
      </WithReason>
    )
  }
  if (artifact.isAvailable) {
    return (
      <WithReason reason={t('status.downloadedHint')}>
        {t('status.downloaded')}
      </WithReason>
    )
  }
  return (
    <WithReason
      reason={t('status.availableHint')}
      className="text-muted-foreground"
    >
      {t('status.available')}
    </WithReason>
  )
}

function WithReason({
  reason,
  className,
  children,
}: {
  reason: string
  className?: string
  children: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'cursor-default text-sm underline decoration-dotted underline-offset-4',
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}
