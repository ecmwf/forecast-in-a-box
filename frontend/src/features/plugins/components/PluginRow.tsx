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
 * PluginRow Component
 *
 * Individual row in the plugins table/list
 */

import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Eye, MoreVertical, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CapabilityBadges } from './CapabilityBadges'
import { PluginIcon } from './PluginIcon'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import { PluginStatusBadge } from '@/features/plugins'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { H4, P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface PluginRowProps {
  plugin: PluginInfo
  onToggle: (compositeId: PluginCompositeId, enabled: boolean) => void
  onUninstall: (compositeId: PluginCompositeId) => void
  onViewDetails?: (plugin: PluginInfo) => void
}

export function PluginRow({
  plugin,
  onToggle,
  onUninstall,
  onViewDetails,
}: PluginRowProps) {
  const { t } = useTranslation('plugins')

  const updatedTimeAgo = plugin.updatedAt
    ? formatDistanceToNow(new Date(plugin.updatedAt), { addSuffix: true })
    : null

  const hasError = plugin.status === 'errored'

  return (
    <div
      className={cn(
        'group grid grid-cols-1 items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/50 sm:grid-cols-12',
        !plugin.isEnabled && 'opacity-75 hover:opacity-100',
        hasError && 'bg-red-50/50 dark:bg-red-950/20',
      )}
    >
      {/* Plugin Details */}
      <div className="flex items-start gap-4 sm:col-span-5">
        <PluginIcon plugin={plugin} />
        <div>
          <div className="flex items-center gap-2">
            <H4 className="text-sm font-semibold">{plugin.name}</H4>
            {hasError && (
              <Tooltip>
                <TooltipTrigger>
                  <AlertCircle className="h-4 w-4 text-red-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <P className="max-w-xs text-xs">
                    {plugin.errorDetail || t('status.errored')}
                  </P>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <P className="mt-0.5 line-clamp-1 text-muted-foreground">
            {plugin.description}
          </P>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {plugin.version && (
              <span className="font-mono text-sm text-muted-foreground">
                v{plugin.version}
                {updatedTimeAgo && <> · Updated {updatedTimeAgo}</>}
              </span>
            )}
            {plugin.capabilities.length > 0 && (
              <CapabilityBadges capabilities={plugin.capabilities} />
            )}
          </div>
        </div>
      </div>

      {/* Author */}
      <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:col-span-3 sm:flex">
        <div className="size-5 rounded-full bg-muted" />
        {plugin.author}
      </div>

      {/* Status */}
      <div className="flex items-center sm:col-span-2">
        <PluginStatusBadge
          status={plugin.status}
          hasUpdate={plugin.hasUpdate}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {/* View Details Button */}
        {onViewDetails && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onViewDetails(plugin)}
          >
            <Eye className="h-4 w-4" />
            <span className="hidden lg:inline">{t('actions.viewDetails')}</span>
          </Button>
        )}

        {/* Toggle Switch */}
        {plugin.isInstalled && (
          <Switch
            checked={plugin.isEnabled}
            onCheckedChange={(checked) => onToggle(plugin.id, checked)}
            aria-label={
              plugin.isEnabled ? t('actions.disable') : t('actions.enable')
            }
          />
        )}

        {/* More Options */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="More options"
              />
            }
          >
            <MoreVertical className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {plugin.pipSource && (
              <DropdownMenuItem
                render={
                  <a
                    href={`https://pypi.org/project/${plugin.pipSource.split('/').pop()?.replace('.git', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                {t('actions.viewOnPyPI')}
              </DropdownMenuItem>
            )}
            {plugin.isInstalled && (
              <>
                {plugin.pipSource && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onUninstall(plugin.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.uninstall')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
