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

import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { DeleteArtifactTarget } from '@/features/artifacts/components/ConfirmDeleteArtifactDialog'
import { decodeArtifactId } from '@/api/types/artifacts.types'
import {
  useArtifactDetail,
  useDeleteModel,
  useDownloadModel,
} from '@/api/hooks/useArtifacts'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ArtifactDetailPage } from '@/features/artifacts/components/ArtifactDetailPage'
import { ConfirmDeleteArtifactDialog } from '@/features/artifacts/components/ConfirmDeleteArtifactDialog'

export const Route = createFileRoute(
  '/_authenticated/admin/artifacts/$artifactId',
)({
  component: ArtifactDetailRoute,
})

function ArtifactDetailRoute() {
  const { t } = useTranslation('artifacts')
  const { artifactId } = Route.useParams()
  const compositeId = decodeArtifactId(artifactId)

  const { data: detail, isLoading } = useArtifactDetail(compositeId)
  const downloadModel = useDownloadModel()
  const deleteModel = useDeleteModel()
  const [pendingDelete, setPendingDelete] =
    useState<DeleteArtifactTarget | null>(null)

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
        {t('detail.notFound', { id: artifactId })}
      </div>
    )
  }

  return (
    <>
      <ArtifactDetailPage
        detail={detail}
        onDownload={(id) => downloadModel.mutate(id)}
        onDelete={(id) => setPendingDelete({ id, name: detail.display_name })}
        onCancelDownload={downloadModel.cancel}
        isDownloading={downloadModel.isDownloading(detail.composite_id)}
        downloadProgress={downloadModel.getProgress(detail.composite_id)}
        isDeleting={deleteModel.isPending}
      />
      <ConfirmDeleteArtifactDialog
        target={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(id) => {
          setPendingDelete(null)
          deleteModel.mutate(id)
        }}
      />
    </>
  )
}
