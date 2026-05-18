/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Model usability breakdown (ready, incompatible, not downloaded) shown from the "Available Models" stat card. */

import { useMemo } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  Download,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useArtifacts } from '@/api/hooks/useArtifacts'
import { SummaryPopover } from '@/components/common/SummaryPopover'

interface ModelSummaryPopoverProps {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

function ModelRow({
  icon,
  label,
  count,
  isLoading,
}: {
  icon: ReactNode
  label: string
  count: number
  isLoading: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      {isLoading ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/30" />
      ) : (
        <span className="text-sm font-medium tabular-nums">{count}</span>
      )}
    </div>
  )
}

export function ModelSummaryPopover({
  children,
  align = 'start',
  side = 'bottom',
}: ModelSummaryPopoverProps) {
  const { t } = useTranslation('dashboard')
  const { artifacts, isLoading } = useArtifacts()

  // Partition by usability: incompatible (can't run here) first, then ready vs. not-downloaded.
  const summary = useMemo(() => {
    let readyToUse = 0
    let incompatible = 0
    let notDownloaded = 0
    for (const artifact of artifacts) {
      if (!artifact.isLocallyCompatible) incompatible += 1
      else if (artifact.isAvailable) readyToUse += 1
      else notDownloaded += 1
    }
    return { readyToUse, incompatible, notDownloaded, total: artifacts.length }
  }, [artifacts])

  return (
    <SummaryPopover
      trigger={children}
      align={align}
      side={side}
      title={
        <Link
          to="/admin/artifacts"
          className="flex items-center gap-2 transition-colors hover:text-primary"
        >
          <Box className="h-4 w-4 text-primary" />
          {t('welcome.stats.availableModels')}
        </Link>
      }
      footer={
        <div className="space-y-2 border-t pt-2">
          <div className="flex items-center justify-between px-2">
            <span className="text-sm font-medium">
              {t('welcome.models.total')}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {isLoading ? '...' : summary.total}
            </span>
          </div>
          <Link
            to="/admin/artifacts"
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-muted/80"
          >
            {t('welcome.models.manage')}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      }
    >
      <div className="space-y-1">
        <ModelRow
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          label={t('welcome.models.readyToUse')}
          count={summary.readyToUse}
          isLoading={isLoading}
        />
        <ModelRow
          icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
          label={t('welcome.models.incompatible')}
          count={summary.incompatible}
          isLoading={isLoading}
        />
        <ModelRow
          icon={<Download className="h-3.5 w-3.5 text-muted-foreground" />}
          label={t('welcome.models.notDownloaded')}
          count={summary.notDownloaded}
          isLoading={isLoading}
        />
      </div>
    </SummaryPopover>
  )
}
