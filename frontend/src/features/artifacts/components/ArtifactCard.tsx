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
 * ArtifactCard Component
 *
 * Card view for an ML model artifact
 */

import { Download, HardDrive, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ArtifactStatusBadge } from './ArtifactStatusBadge'
import type {
  ArtifactInfo,
  CompositeArtifactId,
} from '@/api/types/artifacts.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface ArtifactCardProps {
  artifact: ArtifactInfo
  onDownload: (compositeId: CompositeArtifactId) => void
  onDelete: (compositeId: CompositeArtifactId) => void
  onCancelDownload?: (compositeId: CompositeArtifactId) => void
  onViewDetails?: (artifact: ArtifactInfo) => void
  isDownloading?: boolean
  /** Download progress 0-100, only meaningful when isDownloading is true */
  downloadProgress?: number
  isDeleting?: boolean
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function ArtifactCard({
  artifact,
  onDownload,
  onDelete,
  onCancelDownload,
  onViewDetails,
  isDownloading,
  downloadProgress,
  isDeleting,
  variant,
  shadow,
}: ArtifactCardProps) {
  const { t } = useTranslation('artifacts')

  return (
    <Card
      className={cn(
        'group relative flex flex-col p-4 transition-all duration-300 hover:border-primary/50 sm:p-5',
      )}
      variant={variant}
      shadow={shadow}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2 sm:mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold transition-colors group-hover:text-primary sm:text-lg">
            {artifact.displayName}
          </h3>
          <P className="mt-0.5 truncate font-medium text-muted-foreground">
            {artifact.author}
          </P>
        </div>
        <ArtifactStatusBadge
          isAvailable={artifact.isAvailable}
          downloadProgress={isDownloading ? downloadProgress : undefined}
          className="shrink-0"
        />
      </div>

      {/* Meta */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-6">
        {artifact.diskSize !== '-' && (
          <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            {artifact.diskSize}
          </span>
        )}
        {artifact.platforms.map((platform) => (
          <span
            key={platform}
            className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground"
          >
            {platform}
          </span>
        ))}
      </div>

      {/* Download Progress Bar */}
      {isDownloading && downloadProgress !== undefined && (
        <div className="mb-3">
          <Progress value={Math.round(downloadProgress)} />
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => onViewDetails?.(artifact)}
        >
          {t('actions.viewDetails')}
        </Button>
        {artifact.isAvailable && !isDownloading ? (
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
        ) : isDownloading ? (
          <>
            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary/5"
              disabled
            >
              <Spinner className="mr-1 h-4 w-4" />
              {t('actions.downloading')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => onCancelDownload?.(artifact.id)}
              aria-label={t('actions.cancelDownload')}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="border-primary text-primary hover:bg-primary/5"
            onClick={() => onDownload(artifact.id)}
          >
            <Download className="mr-1 h-4 w-4" />
            {t('actions.download')}
          </Button>
        )}
      </div>
    </Card>
  )
}
