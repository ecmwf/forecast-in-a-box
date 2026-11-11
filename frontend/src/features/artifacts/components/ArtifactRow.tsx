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
import { ArtifactIdLine } from './ArtifactIdLine'
import { ArtifactStatusText } from './ArtifactStatusText'
import { ArtifactTagChips } from './ArtifactTagChips'
import type { ArtifactItemHandlers } from './ArtifactActions'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import { artifactMaturity, nonMaturityTags } from '@/api/types/artifacts.types'
import { useDownloadProgress } from '@/api/hooks/useArtifacts'
import { H4 } from '@/components/base/typography'
import { CatalogueRow } from '@/components/common/catalogue/CatalogueView'

interface ArtifactRowProps extends ArtifactItemHandlers {
  artifact: ArtifactInfo
  isDeleting: boolean
  /** Prefix ids with their store. */
  showStore: boolean
}

export function ArtifactRow({
  artifact,
  isDeleting,
  showStore,
  ...handlers
}: ArtifactRowProps) {
  const { t } = useTranslation('artifacts')
  const { isDownloading, progress, error } = useDownloadProgress(artifact.id)
  const busyLabel = isDownloading
    ? t('actions.downloading')
    : isDeleting
      ? t('actions.deleting')
      : undefined
  // Maturity has its own column.
  const otherTags = nonMaturityTags(artifact.tags)

  return (
    <CatalogueRow>
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <H4 className="truncate text-sm font-semibold">
            <Link
              to="/admin/artifacts/$artifactId"
              params={{ artifactId: artifact.encodedId }}
              className="hover:underline"
            >
              {artifact.displayName}
            </Link>
          </H4>
          <span className="shrink-0 text-sm text-muted-foreground">
            {artifact.author}
          </span>
        </div>
        <ArtifactIdLine
          id={artifact.id}
          showStore={showStore}
          className="mt-0.5"
        />
        {Object.keys(otherTags).length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <ArtifactTagChips
              tags={otherTags}
              max={2}
              className="px-1.5 text-xs"
            />
          </div>
        )}
      </div>

      <div className="hidden text-sm text-muted-foreground capitalize md:block">
        {artifactMaturity(artifact.tags)}
      </div>

      <div className="hidden text-sm text-muted-foreground tabular-nums lg:block">
        {artifact.diskSize !== '-' && artifact.diskSize}
      </div>

      <div>
        <ArtifactStatusText
          artifact={artifact}
          busyLabel={busyLabel}
          downloadError={error}
        />
      </div>

      <ArtifactActions
        artifact={artifact}
        downloadProgress={isDownloading ? (progress ?? 0) : undefined}
        downloadError={error}
        isDeleting={isDeleting}
        layout="row"
        {...handlers}
      />
    </CatalogueRow>
  )
}
