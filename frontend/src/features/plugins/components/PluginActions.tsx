/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Download, ExternalLink, Eye, MoreVertical, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getPyPIUrl } from '../utils/plugin-url'
import type { PluginOperation } from '@/api/hooks/usePlugins'
import type { PluginCompositeId, PluginInfo } from '@/api/types/plugins.types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CatalogueBusy } from '@/components/common/catalogue/CatalogueBusy'
import { PluginToggle } from '@/features/plugins/components/PluginToggle'
import { cn } from '@/lib/utils'

export interface PluginItemHandlers {
  onInstall: (compositeId: PluginCompositeId) => void
  onUninstall: (compositeId: PluginCompositeId) => void
  onUpdate: (compositeId: PluginCompositeId) => void
  onToggle: (compositeId: PluginCompositeId, enabled: boolean) => void
  onViewDetails: (plugin: PluginInfo) => void
}

interface PluginActionsProps extends PluginItemHandlers {
  plugin: PluginInfo
  operation: PluginOperation | undefined
  layout: 'card' | 'row'
}

/** Label for work that replaces the action slot. */
export function usePluginBusyLabel(
  operation: PluginOperation | undefined,
): string | undefined {
  const { t } = useTranslation('plugins')
  switch (operation) {
    case 'install':
      return t('activity.installing')
    case 'update':
      return t('activity.updating')
    case 'uninstall':
      return t('activity.uninstalling')
    default:
      return undefined
  }
}

/** Action slot; install, update and uninstall replace it. */
export function PluginActions({
  plugin,
  operation,
  layout,
  onInstall,
  onUninstall,
  onUpdate,
  onToggle,
  onViewDetails,
}: PluginActionsProps) {
  const { t } = useTranslation('plugins')
  const pypiUrl = getPyPIUrl(plugin.pipSource)

  const busyLabel = usePluginBusyLabel(operation)
  if (busyLabel !== undefined) {
    return <CatalogueBusy className="w-full" label={busyLabel} />
  }

  const labelClass = cn(layout === 'row' && 'hidden xl:inline')

  return (
    <div
      className={cn(
        'flex w-full items-center gap-1.5',
        layout === 'card' ? 'justify-between' : 'justify-end',
      )}
    >
      {!plugin.isInstalled && pypiUrl ? (
        <Button
          variant="ghost"
          className={cn(layout === 'card' && '-ml-2.5')}
          nativeButton={false}
          render={
            <a href={pypiUrl} target="_blank" rel="noopener noreferrer" />
          }
          aria-label={t('actions.viewOnPyPI')}
        >
          <ExternalLink className="h-4 w-4" />
          <span className={labelClass}>{t('actions.pypi')}</span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          className={cn(layout === 'card' && '-ml-2.5')}
          onClick={() => onViewDetails(plugin)}
          aria-label={t('actions.viewDetails')}
        >
          <Eye className="h-4 w-4" />
          <span className={labelClass}>{t('actions.details')}</span>
        </Button>
      )}

      <div
        className={cn(
          'flex items-center justify-end gap-1.5',
          layout === 'row' && 'w-44',
        )}
      >
        {!plugin.isInstalled ? (
          <Button
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/5"
            onClick={() => onInstall(plugin.id)}
          >
            <Download className="h-4 w-4" />
            {t('actions.install')}
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            {plugin.hasUpdate && (
              <Button size="sm" onClick={() => onUpdate(plugin.id)}>
                {t('actions.update')}
              </Button>
            )}
            <PluginToggle
              plugin={plugin}
              pendingEnabled={
                operation === 'enable'
                  ? true
                  : operation === 'disable'
                    ? false
                    : undefined
              }
              onToggle={onToggle}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={t('row.moreOptions')}
                  />
                }
              >
                <MoreVertical className="h-4 w-4" />
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
                  className="text-danger focus:text-danger"
                  onClick={() => onUninstall(plugin.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.uninstall')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
