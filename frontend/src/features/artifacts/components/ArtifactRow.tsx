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
 * ArtifactRow Component
 *
 * Table row for a downloaded ML model artifact.
 * Follows the PluginRow pattern for consistent table layout.
 */

import { Eye, HardDrive, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ArtifactStatusBadge } from './ArtifactStatusBadge'
import type {
  ArtifactInfo,
  CompositeArtifactId,
} from '@/api/types/artifacts.types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { H4, P } from '@/components/base/typography'

interface ArtifactRowProps {
  artifact: ArtifactInfo
  onDelete: (compositeId: CompositeArtifactId) => void
  onViewDetails?: (artifact: ArtifactInfo) => void
  isDeleting?: boolean
}

export function ArtifactRow({
  artifact,
  onDelete,
  onViewDetails,
  isDeleting,
}: ArtifactRowProps) {
  const { t } = useTranslation('artifacts')

  return (
    <div className="group grid grid-cols-1 items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/50 sm:grid-cols-12">
      {/* Model Details */}
      <div className="flex items-start gap-4 sm:col-span-5">
        <div>
          <H4 className="text-sm font-semibold">{artifact.displayName}</H4>
          <P className="mt-0.5 line-clamp-1 text-muted-foreground">
            {artifact.author}
          </P>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {artifact.platforms.map((platform) => (
              <span
                key={platform}
                className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Disk Size */}
      <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:col-span-2 sm:flex">
        {artifact.diskSize !== '-' && (
          <>
            <HardDrive className="h-3.5 w-3.5" />
            {artifact.diskSize}
          </>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center sm:col-span-3">
        <ArtifactStatusBadge isAvailable={artifact.isAvailable} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {onViewDetails && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onViewDetails(artifact)}
          >
            <Eye className="h-4 w-4" />
            <span className="hidden lg:inline">{t('actions.viewDetails')}</span>
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(artifact.id)}
          disabled={isDeleting}
          aria-label={t('actions.delete')}
        >
          {isDeleting ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
