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
 * SourceRow Component
 *
 * Individual row in the sources table view
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
import { H4, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface SourceRowProps {
  source: SourceInfo
  onViewDetails?: (source: SourceInfo) => void
  onDownload?: (sourceId: string) => void
  onToggleEnable?: (sourceId: string, enabled: boolean) => void
  onRemove?: (sourceId: string) => void
  onRetry?: (sourceId: string) => void
}

const iconMap = {
  model: Brain,
  dataset: Database,
}

export function SourceRow({
  source,
  onViewDetails,
  onDownload,
  onToggleEnable,
  onRemove,
  onRetry,
}: SourceRowProps) {
  const { t } = useTranslation('sources')
  const Icon = iconMap[source.sourceType]

  const isActionable =
    source.status === 'ready' || source.status === 'available'
  const showDownload = source.status === 'available'
  const showRetry = source.status === 'error'

  return (
    <div
      className={cn(
        'group grid grid-cols-1 items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/50 sm:grid-cols-12',
        !isActionable && 'opacity-80 hover:opacity-100',
      )}
    >
      {/* Source Details */}
      <div className="flex items-start gap-4 sm:col-span-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <H4 className="text-sm font-semibold">{source.name}</H4>
          <P className="mt-0.5 text-muted-foreground">{source.pluginName}</P>
          <P className="mt-1 line-clamp-1 text-muted-foreground">
            {source.description}
          </P>
        </div>
      </div>

      {/* Type */}
      <div className="flex items-center sm:col-span-2">
        <SourceTypeBadge type={source.sourceType} size="sm" />
      </div>

      {/* Status */}
      <div className="flex items-center sm:col-span-2">
        {source.status === 'downloading' ? (
          <div className="flex w-full max-w-37.5 items-center gap-3">
            <span className="w-10 text-sm font-bold">
              {Math.round(source.downloadProgress ?? 0)}%
            </span>
            <div className="h-2 grow overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${source.downloadProgress ?? 0}%` }}
              />
            </div>
          </div>
        ) : (
          <SourceStatusBadge status={source.status} />
        )}
      </div>

      {/* Plugin */}
      <div className="hidden sm:col-span-2 sm:block">
        <P className="line-clamp-1 text-muted-foreground">{source.author}</P>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        {showDownload && (
          <Button
            variant="outline"
            size="sm"
            className="border-primary text-primary hover:bg-primary/5"
            onClick={() => onDownload?.(source.id)}
          >
            <Download className="mr-1 h-4 w-4" />
            {t('actions.download')}
          </Button>
        )}

        {showRetry && (
          <Button
            variant="outline"
            size="sm"
            className="border-primary text-primary hover:bg-primary/5"
            onClick={() => onRetry?.(source.id)}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {t('actions.retry')}
          </Button>
        )}

        {source.status === 'ready' && (
          <Switch
            checked={source.isEnabled}
            onCheckedChange={(checked) => onToggleEnable?.(source.id, checked)}
            aria-label={
              source.isEnabled ? t('actions.disable') : t('actions.enable')
            }
          />
        )}

        {source.status === 'ready' && !source.isDefault && (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onRemove?.(source.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}

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
    </div>
  )
}
