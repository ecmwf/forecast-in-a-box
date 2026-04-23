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
 * ArtifactsList Component
 *
 * Renders downloaded artifacts in either table or card view.
 * Follows the PluginsList pattern for responsive table design.
 */

import { Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ArtifactCard } from './ArtifactCard'
import { ArtifactRow } from './ArtifactRow'
import type {
  ArtifactInfo,
  CompositeArtifactId,
} from '@/api/types/artifacts.types'
import type {
  AdminViewMode,
  DashboardVariant,
  PanelShadow,
} from '@/stores/uiStore'
import { H3, P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import { useMedia } from '@/hooks/useMedia'

interface ArtifactsListProps {
  artifacts: Array<ArtifactInfo>
  viewMode: AdminViewMode
  onDelete: (compositeId: CompositeArtifactId) => void
  onViewDetails?: (artifact: ArtifactInfo) => void
  deletingId?: CompositeArtifactId
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function ArtifactsList({
  artifacts,
  viewMode,
  onDelete,
  onViewDetails,
  deletingId,
  variant,
  shadow,
}: ArtifactsListProps) {
  const { t } = useTranslation('artifacts')

  // Force card view on mobile
  const isMobile = useMedia('(max-width: 639px)')
  const effectiveViewMode = isMobile ? 'card' : viewMode

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Package className="mb-4 h-16 w-16 text-muted-foreground/50" />
        <H3 className="mb-2 text-lg font-semibold">{t('emptyState.title')}</H3>
        <P className="max-w-md text-muted-foreground">
          {t('emptyState.description')}
        </P>
      </div>
    )
  }

  // Card view (forced on mobile)
  if (effectiveViewMode === 'card') {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {artifacts.map((artifact) => {
          const isDeleting =
            deletingId !== undefined &&
            deletingId.artifact_store_id === artifact.id.artifact_store_id &&
            deletingId.ml_model_checkpoint_id ===
              artifact.id.ml_model_checkpoint_id

          return (
            <ArtifactCard
              key={artifact.encodedId}
              artifact={artifact}
              onDownload={() => {}}
              onDelete={onDelete}
              onViewDetails={onViewDetails}
              isDeleting={isDeleting}
              variant={variant}
              shadow={shadow}
            />
          )
        })}
      </div>
    )
  }

  // Table view
  return (
    <Card className="overflow-hidden" variant={variant} shadow={shadow}>
      {/* Header Row */}
      <div className="hidden grid-cols-12 gap-4 border-b border-border bg-muted/50 px-6 py-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase sm:grid">
        <div className="col-span-5">{t('table.model')}</div>
        <div className="col-span-2">{t('table.size')}</div>
        <div className="col-span-3">{t('table.status')}</div>
        <div className="col-span-2 text-right">{t('table.actions')}</div>
      </div>

      {/* Artifact Rows */}
      <div className="divide-y divide-border">
        {artifacts.map((artifact) => {
          const isDeleting =
            deletingId !== undefined &&
            deletingId.artifact_store_id === artifact.id.artifact_store_id &&
            deletingId.ml_model_checkpoint_id ===
              artifact.id.ml_model_checkpoint_id

          return (
            <ArtifactRow
              key={artifact.encodedId}
              artifact={artifact}
              onDelete={onDelete}
              onViewDetails={onViewDetails}
              isDeleting={isDeleting}
            />
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border bg-muted/50 px-6 py-4">
        <span className="text-sm text-muted-foreground">
          {t('pagination.showing', {
            start: 1,
            end: artifacts.length,
            total: artifacts.length,
          })}
        </span>
      </div>
    </Card>
  )
}
