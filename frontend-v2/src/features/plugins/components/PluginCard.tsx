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
 * PluginCard Component
 *
 * Card view for a plugin
 */

import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  Download,
  ExternalLink,
  MoreVertical,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CapabilityBadges } from './CapabilityBadges'
import { PluginIcon } from './PluginIcon'
import { PluginStatusBadge } from './PluginStatusBadge'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Spinner } from '@/components/ui/spinner'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface PluginCardProps {
  plugin: PluginInfo
  onToggle: (compositeId: PluginCompositeId, enabled: boolean) => void
  onInstall: (compositeId: PluginCompositeId) => void
  onUninstall: (compositeId: PluginCompositeId) => void
  onUpdate: (compositeId: PluginCompositeId) => void
  onViewDetails?: (plugin: PluginInfo) => void
  isInstalling?: boolean
  variant?: DashboardVariant
  shadow?: PanelShadow
}

/**
 * Get PyPI URL for a plugin from its pip source
 */
function getPyPIUrl(pipSource: string | null): string | null {
  if (!pipSource) return null
  const packageName = pipSource.split('/').pop()?.replace('.git', '')
  return packageName ? `https://pypi.org/project/${packageName}` : null
}

export function PluginCard({
  plugin,
  onToggle,
  onInstall,
  onUninstall,
  onUpdate,
  onViewDetails,
  isInstalling,
  variant,
  shadow,
}: PluginCardProps) {
  const { t } = useTranslation('plugins')
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

  const updatedTimeAgo = plugin.updatedAt
    ? formatDistanceToNow(new Date(plugin.updatedAt), { addSuffix: true })
    : null

  // Use compact layout for uninstalled plugins
  const isCompact = !plugin.isInstalled

  // Show error state
  const hasError = plugin.status === 'errored'

  // PyPI URL for available plugins
  const pypiUrl = getPyPIUrl(plugin.pipSource)

  return (
    <Card
      className={cn(
        'group relative flex flex-col transition-all duration-300 hover:border-primary/50',
        isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5',
        !plugin.isEnabled &&
          plugin.isInstalled &&
          'opacity-80 hover:opacity-100',
        hasError && 'border-red-200 dark:border-red-800',
      )}
      variant={variant}
      shadow={shadow}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-start justify-between gap-2',
          isCompact ? 'mb-2' : 'mb-3 sm:mb-4',
        )}
      >
        <div className="flex min-w-0 gap-2 sm:gap-3">
          <PluginIcon plugin={plugin} size={isCompact ? 'sm' : 'md'} />
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                'truncate font-semibold transition-colors group-hover:text-primary',
                isCompact ? 'text-sm' : 'text-base sm:text-lg',
              )}
            >
              {plugin.name}
            </h3>
            <P className="mt-0.5 truncate font-medium text-muted-foreground">
              {plugin.author}
            </P>
          </div>
        </div>
        <PluginStatusBadge
          status={plugin.status}
          hasUpdate={plugin.hasUpdate}
          className="shrink-0"
        />
      </div>

      {/* Description */}
      {isCompact ? (
        // Available plugins: expandable description
        <button
          type="button"
          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
          className={cn(
            'mb-2 text-left text-sm leading-relaxed text-muted-foreground transition-colors hover:text-foreground',
            !isDescriptionExpanded && 'line-clamp-1',
          )}
        >
          {plugin.description}
        </button>
      ) : (
        // Installed plugins: static truncated description
        <P
          className={cn(
            'leading-relaxed text-muted-foreground',
            'mb-3 line-clamp-2 sm:mb-5',
          )}
        >
          {plugin.description}
        </P>
      )}

      {/* Error Alert */}
      {hasError && plugin.errorDetail && (
        <Alert variant="destructive" className="mb-3 py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {plugin.errorDetail}
          </AlertDescription>
        </Alert>
      )}

      {/* Capabilities - only show for installed plugins with capabilities */}
      {plugin.isInstalled && plugin.capabilities.length > 0 && (
        <div className="mb-3 sm:mb-4">
          <CapabilityBadges capabilities={plugin.capabilities} />
        </div>
      )}

      {/* Version Info */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2',
          isCompact ? 'mb-2' : 'mb-3 sm:mb-6',
        )}
      >
        {plugin.version ? (
          // Installed plugin: show installed version
          <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 font-mono text-sm font-medium text-muted-foreground">
            v{plugin.version}
          </span>
        ) : (
          // Available plugin: show latest version (hide if unknown)
          plugin.latestVersion &&
          plugin.latestVersion !== 'unknown' && (
            <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 font-mono text-sm font-medium text-muted-foreground">
              v{plugin.latestVersion}
            </span>
          )
        )}
        {plugin.latestVersion &&
          plugin.version &&
          plugin.latestVersion !== plugin.version && (
            <span className="inline-flex items-center gap-1.5 rounded bg-amber-100 px-2 py-0.5 font-mono text-sm font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              → v{plugin.latestVersion}
            </span>
          )}
        {updatedTimeAgo && (
          <span className="text-sm text-muted-foreground">
            Updated {updatedTimeAgo}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2">
        {plugin.isInstalled ? (
          <>
            {plugin.hasUpdate ? (
              <Button className="flex-1" onClick={() => onUpdate(plugin.id)}>
                <Download className="mr-1 h-4 w-4" />
                {t('actions.update')}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onViewDetails?.(plugin)}
              >
                {t('actions.viewDetails')}
              </Button>
            )}
            <Switch
              checked={plugin.isEnabled}
              onCheckedChange={(checked) => onToggle(plugin.id, checked)}
              aria-label={
                plugin.isEnabled ? t('actions.disable') : t('actions.enable')
              }
            />
          </>
        ) : (
          <>
            {pypiUrl ? (
              <Button
                variant="outline"
                className="flex-1"
                render={
                  <a href={pypiUrl} target="_blank" rel="noopener noreferrer" />
                }
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                {t('actions.viewDetails')}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onViewDetails?.(plugin)}
              >
                {t('actions.viewDetails')}
              </Button>
            )}
            <Button
              variant="outline"
              className="flex-1 border-primary text-primary hover:bg-primary/5"
              onClick={() => onInstall(plugin.id)}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <Spinner className="mr-1 h-4 w-4" />
              ) : (
                <Download className="mr-1 h-4 w-4" />
              )}
              {isInstalling ? t('actions.installing') : t('actions.install')}
            </Button>
          </>
        )}
        {plugin.isInstalled && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" />}
            >
              <MoreVertical className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {pypiUrl && (
                <DropdownMenuItem
                  render={
                    <a
                      href={pypiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  {t('actions.viewOnPyPI')}
                </DropdownMenuItem>
              )}
              {plugin.comment && (
                <DropdownMenuItem disabled>
                  <span className="text-xs text-muted-foreground">
                    {plugin.comment}
                  </span>
                </DropdownMenuItem>
              )}
              {(pypiUrl || plugin.comment) && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onUninstall(plugin.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('actions.uninstall')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </Card>
  )
}
