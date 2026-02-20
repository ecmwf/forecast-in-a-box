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
 * SourceCard Component
 *
 * Displays a source card with status, type, and actions
 */

import {
  Brain,
  Database,
  Download,
  MoreVertical,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SourceStatusBadge } from './SourceStatusBadge'
import { SourceTypeBadge } from './SourceTypeBadge'
import type { SourceInfo } from '@/api/types/sources.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { H3, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface SourceCardProps {
  source: SourceInfo
  onViewDetails?: (source: SourceInfo) => void
  onDownload?: (sourceId: string) => void
  onToggleEnable?: (sourceId: string, enabled: boolean) => void
  onRemove?: (sourceId: string) => void
  onRetry?: (sourceId: string) => void
  variant?: DashboardVariant
  shadow?: PanelShadow
}

const iconMap = {
  model: Brain,
  dataset: Database,
}

export function SourceCard({
  source,
  onViewDetails,
  onDownload,
  onToggleEnable,
  onRemove,
  onRetry,
  variant,
  shadow,
}: SourceCardProps) {
  const { t } = useTranslation('sources')
  const Icon = iconMap[source.sourceType]

  const isActionable =
    source.status === 'ready' || source.status === 'available'
  const showDownload = source.status === 'available'
  const showRetry = source.status === 'error'

  return (
    <Card
      className={cn(
        'group relative flex flex-col p-4 transition-all duration-300 hover:border-primary/50 sm:p-5',
        !isActionable && 'opacity-80 hover:opacity-100',
      )}
      variant={variant}
      shadow={shadow}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2 sm:mb-4">
        <div className="flex min-w-0 flex-1 gap-2 sm:gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted sm:h-12 sm:w-12">
            <Icon className="h-5 w-5 text-muted-foreground sm:h-7 sm:w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <H3 className="truncate text-base font-semibold transition-colors group-hover:text-primary sm:text-lg">
              {source.name}
            </H3>
            <P className="mt-0.5 truncate font-medium text-muted-foreground">
              {t('card.providedBy', { plugin: source.pluginName })}
            </P>
          </div>
        </div>
        <SourceStatusBadge
          status={source.status}
          downloadProgress={source.downloadProgress}
        />
      </div>

      {/* Download Progress */}
      {source.status === 'downloading' && (
        <div className="mb-3 rounded-lg bg-muted p-2 sm:mb-5 sm:p-3">
          <div className="mb-1.5 flex justify-between text-sm font-medium">
            <span>{t('status.downloading')}</span>
            <span className="text-primary">
              {Math.round(source.downloadProgress ?? 0)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/20">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${source.downloadProgress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {source.status === 'error' && source.downloadError && (
        <div className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700 sm:mb-5 sm:p-3 dark:bg-red-900/20 dark:text-red-400">
          {source.downloadError}
        </div>
      )}

      {/* Description */}
      {source.status !== 'downloading' && source.status !== 'error' && (
        <P className="mb-3 line-clamp-2 leading-relaxed text-muted-foreground sm:mb-5">
          {source.description}
        </P>
      )}

      {/* Metadata */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-6">
        <SourceTypeBadge type={source.sourceType} size="sm" />
        {source.registry && (
          <span className="text-sm text-muted-foreground">
            {source.registry}
          </span>
        )}
        {source.size && (
          <span className="text-sm text-muted-foreground">
            {t('card.size', { size: source.size })}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-3">
        {source.status === 'downloading' ? (
          <div className="flex-1 text-sm text-muted-foreground">
            {t('status.downloading')}...
          </div>
        ) : showDownload ? (
          <Button
            variant="outline"
            className="flex-1 border-primary text-primary hover:bg-primary/5"
            onClick={() => onDownload?.(source.id)}
          >
            <Download className="mr-1 h-4 w-4" />
            {t('actions.download')}
          </Button>
        ) : showRetry ? (
          <Button
            variant="outline"
            className="flex-1 border-primary text-primary hover:bg-primary/5"
            onClick={() => onRetry?.(source.id)}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {t('actions.retry')}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onViewDetails?.(source)}
          >
            {t('actions.viewDetails')}
          </Button>
        )}

        {/* Enable/Disable Toggle */}
        {source.status === 'ready' && (
          <Switch
            checked={source.isEnabled}
            onCheckedChange={(checked) => onToggleEnable?.(source.id, checked)}
            aria-label={
              source.isEnabled ? t('actions.disable') : t('actions.enable')
            }
          />
        )}

        {/* More Options */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewDetails?.(source)}>
              {t('actions.viewDetails')}
            </DropdownMenuItem>
            {source.status === 'ready' && !source.isDefault && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onRemove?.(source.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.remove')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}
