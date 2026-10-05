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
import { Link } from '@tanstack/react-router'
import { ArtifactActions } from './ArtifactActions'
import { ArtifactCompatibilityBadge } from './ArtifactCompatibilityBadge'
import { ArtifactStatusBadge } from './ArtifactStatusBadge'
import { ArtifactTagChips } from './ArtifactTagChips'
import type { ArtifactItemHandlers } from './ArtifactActions'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import { useDownloadProgress } from '@/api/hooks/useArtifacts'
import { H4, P } from '@/components/base/typography'
import { CatalogueRow } from '@/components/common/catalogue/CatalogueView'

interface ArtifactRowProps extends ArtifactItemHandlers {
  artifact: ArtifactInfo
  isDeleting: boolean
}

export function ArtifactRow({
  artifact,
  isDeleting,
  ...handlers
}: ArtifactRowProps) {
  const { t } = useTranslation('artifacts')
  const { isDownloading, progress } = useDownloadProgress(artifact.id)
  const busyLabel = isDownloading
    ? t('actions.downloading')
    : isDeleting
      ? t('actions.deleting')
      : undefined

  return (
    <CatalogueRow>
      <div className="min-w-0">
        <H4 className="truncate text-sm font-semibold">
          <Link
            to="/admin/artifacts/$artifactId"
            params={{ artifactId: artifact.encodedId }}
            className="hover:underline"
          >
            {artifact.displayName}
          </Link>
        </H4>
        <P className="mt-0.5 truncate text-muted-foreground">
          {artifact.author}
        </P>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {artifact.platforms.map((platform) => (
            <span
              key={platform}
              className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {platform}
            </span>
          ))}
          <ArtifactTagChips
            tags={artifact.tags}
            max={2}
            className="px-1.5 text-xs"
          />
          <ArtifactCompatibilityBadge
            artifact={artifact}
            className="px-1.5 text-xs"
          />
        </div>
      </div>

      <div className="hidden text-sm text-muted-foreground tabular-nums lg:block">
        {artifact.diskSize !== '-' && artifact.diskSize}
      </div>

      <div>
        <ArtifactStatusBadge
          isAvailable={artifact.isAvailable}
          busyLabel={busyLabel}
        />
      </div>

      <ArtifactActions
        artifact={artifact}
        downloadProgress={isDownloading ? (progress ?? 0) : undefined}
        isDeleting={isDeleting}
        layout="row"
        {...handlers}
      />
    </CatalogueRow>
  )
}
