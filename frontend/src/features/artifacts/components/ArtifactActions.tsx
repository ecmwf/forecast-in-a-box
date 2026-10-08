/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Download, Eye, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ArtifactInfo,
  CompositeArtifactId,
} from '@/api/types/artifacts.types'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CatalogueBusy } from '@/components/common/catalogue/CatalogueBusy'
import { cn } from '@/lib/utils'

export interface ArtifactItemHandlers {
  onDownload: (compositeId: CompositeArtifactId) => void
  onDelete: (compositeId: CompositeArtifactId) => void
  onViewDetails: (artifact: ArtifactInfo) => void
}

interface ArtifactActionsProps extends ArtifactItemHandlers {
  artifact: ArtifactInfo
  /** 0-100 while downloading. */
  downloadProgress: number | undefined
  isDeleting: boolean
  layout: 'card' | 'row'
}

/** Action slot; in-flight work replaces the buttons. */
export function ArtifactActions({
  artifact,
  downloadProgress,
  isDeleting,
  layout,
  onDownload,
  onDelete,
  onViewDetails,
}: ArtifactActionsProps) {
  const { t } = useTranslation('artifacts')

  if (downloadProgress !== undefined) {
    return (
      <CatalogueBusy
        className="w-full"
        label={t('actions.downloading')}
        progress={downloadProgress}
      />
    )
  }
  if (isDeleting) {
    return <CatalogueBusy className="w-full" label={t('actions.deleting')} />
  }

  const downloadButton = (
    <Button
      variant="outline"
      className="border-primary/40 text-primary hover:bg-primary/5"
      onClick={() => onDownload(artifact.id)}
      disabled={!artifact.isLocallyCompatible}
    >
      <Download className="h-4 w-4" />
      {t('actions.download')}
    </Button>
  )

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2',
        layout === 'card' ? 'justify-between' : 'justify-end',
      )}
    >
      <Button
        variant="ghost"
        className={cn(layout === 'card' && '-ml-2.5')}
        onClick={() => onViewDetails(artifact)}
      >
        <Eye className="h-4 w-4" />
        {t('actions.viewDetails')}
      </Button>
      <div className={cn('flex justify-end', layout === 'row' && 'w-30')}>
        {artifact.isAvailable ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-danger"
            onClick={() => onDelete(artifact.id)}
            aria-label={t('actions.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : artifact.isLocallyCompatible ? (
          downloadButton
        ) : (
          // Runs can't use incompatible checkpoints.
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              {downloadButton}
            </TooltipTrigger>
            <TooltipContent>
              {artifact.localCompatibilityDetail
                ? t('compatibility.notCompatibleDetail', {
                    detail: artifact.localCompatibilityDetail,
                  })
                : t('compatibility.notCompatible')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
