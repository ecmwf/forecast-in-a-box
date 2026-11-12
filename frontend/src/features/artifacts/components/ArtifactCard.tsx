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
import {
  CatalogueFact,
  CatalogueFacts,
} from '@/components/common/catalogue/CatalogueFacts'
import { Card } from '@/components/ui/card'

interface ArtifactCardProps extends ArtifactItemHandlers {
  artifact: ArtifactInfo
  isDeleting: boolean
  /** Prefix ids with their store. */
  showStore: boolean
}

export function ArtifactCard({
  artifact,
  isDeleting,
  showStore,
  ...handlers
}: ArtifactCardProps) {
  const { t } = useTranslation('artifacts')
  const { isDownloading, progress, error } = useDownloadProgress(artifact.id)
  const busyLabel = isDownloading
    ? t('actions.downloading')
    : isDeleting
      ? t('actions.deleting')
      : undefined
  const maturity = artifactMaturity(artifact.tags)
  // Maturity has its own field.
  const otherTags = nonMaturityTags(artifact.tags)

  return (
    <Card className="group w-full gap-0 py-0 transition-colors hover:border-primary/30">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="truncate text-base font-semibold">
              <Link
                to="/admin/artifacts/$artifactId"
                params={{ artifactId: artifact.encodedId }}
                className="hover:underline"
              >
                {artifact.displayName}
              </Link>
            </h3>
            <span className="shrink-0 text-sm text-muted-foreground">
              {artifact.author}
            </span>
          </div>
          <ArtifactIdLine
            id={artifact.id}
            showStore={showStore}
            className="mt-0.5"
          />
        </div>

        {/* The table's columns as labelled values. */}
        <CatalogueFacts>
          {maturity !== null && (
            <CatalogueFact label={t('table.maturity')}>
              <span className="capitalize">{maturity}</span>
            </CatalogueFact>
          )}
          {artifact.diskSize !== '-' && (
            <CatalogueFact label={t('table.size')}>
              <span className="tabular-nums">{artifact.diskSize}</span>
            </CatalogueFact>
          )}
          <CatalogueFact label={t('table.availability')}>
            <ArtifactStatusText
              artifact={artifact}
              busyLabel={busyLabel}
              downloadError={error}
            />
          </CatalogueFact>
        </CatalogueFacts>

        {Object.keys(otherTags).length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <ArtifactTagChips tags={otherTags} max={3} />
          </div>
        )}
      </div>

      <div className="flex items-center border-t border-border/60 px-5 py-3">
        <ArtifactActions
          artifact={artifact}
          downloadProgress={isDownloading ? (progress ?? 0) : undefined}
          downloadError={error}
          isDeleting={isDeleting}
          layout="card"
          {...handlers}
        />
      </div>
    </Card>
  )
}
