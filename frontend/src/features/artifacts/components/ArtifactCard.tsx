/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ArtifactActions } from './ArtifactActions'
import { ArtifactCompatibilityBadge } from './ArtifactCompatibilityBadge'
import { ArtifactIdLine } from './ArtifactIdLine'
import { ArtifactStatusBadge } from './ArtifactStatusBadge'
import { ArtifactTagChips } from './ArtifactTagChips'
import type { ArtifactItemHandlers } from './ArtifactActions'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import { useDownloadProgress } from '@/api/hooks/useArtifacts'
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

  return (
    <Card className="group w-full gap-0 py-0 transition-colors hover:border-primary/30">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
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
          <ArtifactStatusBadge
            isAvailable={artifact.isAvailable}
            busyLabel={busyLabel}
            downloadError={error}
            className="shrink-0"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {artifact.diskSize !== '-' && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              {artifact.diskSize}
            </span>
          )}
          {artifact.platforms.map((platform) => (
            <span
              key={platform}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground"
            >
              {platform}
            </span>
          ))}
          <ArtifactTagChips tags={artifact.tags} max={3} />
          <ArtifactCompatibilityBadge artifact={artifact} />
        </div>
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
