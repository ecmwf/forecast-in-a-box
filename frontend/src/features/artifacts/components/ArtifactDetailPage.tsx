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
 * ArtifactDetailPage Component
 *
 * Full-page view of ML model artifact details with characteristics,
 * constraints, and download/delete actions.
 */

import {
  ArrowLeft,
  Download,
  ExternalLink,
  HardDrive,
  Trash2,
  X,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArtifactStatusBadge } from './ArtifactStatusBadge'
import type {
  CompositeArtifactId,
  MlModelDetail,
} from '@/api/types/artifacts.types'
import { formatBytes } from '@/api/types/artifacts.types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { H1, H2, P } from '@/components/base/typography'

export interface ArtifactDetailPageProps {
  detail: MlModelDetail
  onDownload: (compositeId: CompositeArtifactId) => void
  onDelete: (compositeId: CompositeArtifactId) => void
  onCancelDownload?: (compositeId: CompositeArtifactId) => void
  isDownloading?: boolean
  /** Download progress 0-100, only meaningful when isDownloading is true */
  downloadProgress?: number
  isDeleting?: boolean
}

export function ArtifactDetailPage({
  detail,
  onDownload,
  onDelete,
  onCancelDownload,
  isDownloading,
  downloadProgress,
  isDeleting,
}: ArtifactDetailPageProps) {
  const { t } = useTranslation('artifacts')

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Back button */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        render={<Link to="/admin/artifacts" />}
      >
        <ArrowLeft className="h-4 w-4" />
        {t('actions.backToArtifacts')}
      </Button>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <H1 className="text-2xl font-bold">{detail.display_name}</H1>
          <P className="mt-1 text-muted-foreground">{detail.display_author}</P>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ArtifactStatusBadge
              isAvailable={detail.is_available}
              downloadProgress={isDownloading ? downloadProgress : undefined}
            />
            {detail.disk_size_bytes !== null && (
              <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5" />
                {formatBytes(detail.disk_size_bytes)}
              </span>
            )}
            {detail.supported_platforms.map((platform) => (
              <span
                key={platform}
                className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground"
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {detail.url && (
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="mr-1 h-4 w-4" />
              URL
            </Button>
          )}
          {detail.is_available && !isDownloading ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(detail.composite_id)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Spinner className="mr-1 h-4 w-4" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              {t('actions.delete')}
            </Button>
          ) : isDownloading ? (
            <>
              <Button size="sm" disabled>
                <Spinner className="mr-1 h-4 w-4" />
                {t('actions.downloading')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onCancelDownload?.(detail.composite_id)}
              >
                <X className="mr-1 h-4 w-4" />
                {t('actions.cancelDownload')}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => onDownload(detail.composite_id)}>
              <Download className="mr-1 h-4 w-4" />
              {t('actions.download')}
            </Button>
          )}
        </div>
      </div>

      {/* Download Progress Bar */}
      {isDownloading && downloadProgress !== undefined && (
        <Progress value={Math.round(downloadProgress)} />
      )}

      {/* Description */}
      {detail.display_description && (
        <P className="text-muted-foreground">{detail.display_description}</P>
      )}

      <Separator />

      {/* Pip Package Constraints */}
      <div>
        <H2 className="mb-3 text-lg font-semibold">
          {t('detail.pipConstraints')}
        </H2>
        {detail.pip_package_constraints.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {detail.pip_package_constraints.map((constraint) => (
              <span
                key={constraint}
                className="rounded bg-muted px-2.5 py-1 font-mono text-sm text-muted-foreground"
              >
                {constraint}
              </span>
            ))}
          </div>
        ) : (
          <P className="text-sm text-muted-foreground">
            {t('detail.noConstraints')}
          </P>
        )}
      </div>

      {/* Output Characteristics */}
      <div>
        <H2 className="mb-3 text-lg font-semibold">
          {t('detail.outputCharacteristics')}
        </H2>
        <CharacteristicsCard data={detail.output_characteristics} />
      </div>

      {/* Input Characteristics */}
      <div>
        <H2 className="mb-3 text-lg font-semibold">
          {t('detail.inputCharacteristics')}
        </H2>
        <CharacteristicsCard data={detail.input_characteristics} />
      </div>
    </div>
  )
}

function CharacteristicsCard({
  data,
}: {
  data: Array<string> | Record<string, unknown>
}) {
  const { t } = useTranslation('artifacts')

  // Array of strings (e.g. ["u", "v", "t", "q"])
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <P className="text-sm text-muted-foreground">
          {t('detail.noCharacteristics')}
        </P>
      )
    }
    return (
      <div className="flex flex-wrap gap-2">
        {data.map((item) => (
          <span
            key={item}
            className="rounded bg-muted px-2.5 py-1 font-mono text-sm text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    )
  }

  // Object/record (e.g. { variables: [...], resolution: "0.25 degrees" })
  const entries = Object.entries(data)

  if (entries.length === 0) {
    return (
      <P className="text-sm text-muted-foreground">
        {t('detail.noCharacteristics')}
      </P>
    )
  }

  return (
    <Card className="divide-y divide-border overflow-hidden">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start gap-4 px-4 py-3">
          <span className="min-w-[140px] text-sm font-medium text-muted-foreground">
            {key}
          </span>
          <span className="text-sm">
            {Array.isArray(value) ? value.join(', ') : String(value)}
          </span>
        </div>
      ))}
    </Card>
  )
}
