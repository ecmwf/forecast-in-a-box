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
 * Artifact Detail Route
 *
 * Shows full details for a single ML model artifact.
 */

import { createFileRoute } from '@tanstack/react-router'
import { decodeArtifactId } from '@/api/types/artifacts.types'
import {
  useArtifactDetail,
  useDeleteModel,
  useDownloadModel,
} from '@/api/hooks/useArtifacts'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ArtifactDetailPage } from '@/features/artifacts/components/ArtifactDetailPage'

export const Route = createFileRoute(
  '/_authenticated/admin/artifacts/$artifactId',
)({
  component: ArtifactDetailRoute,
})

function ArtifactDetailRoute() {
  const { artifactId } = Route.useParams()
  const compositeId = decodeArtifactId(artifactId)

  const { data: detail, isLoading } = useArtifactDetail(compositeId)
  const downloadModel = useDownloadModel()
  const deleteModel = useDeleteModel()

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-muted-foreground">
        Model not found: {artifactId}
      </div>
    )
  }

  return (
    <ArtifactDetailPage
      detail={detail}
      onDownload={(id) => downloadModel.mutate(id)}
      onDelete={(id) => deleteModel.mutate(id)}
      onCancelDownload={downloadModel.cancel}
      isDownloading={downloadModel.isDownloading(detail.composite_id)}
      downloadProgress={downloadModel.getProgress(detail.composite_id)}
      isDeleting={deleteModel.isPending}
    />
  )
}
