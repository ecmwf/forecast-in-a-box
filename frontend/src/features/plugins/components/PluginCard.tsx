/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { CapabilityBadges } from './CapabilityBadges'
import { PluginActions, usePluginBusyLabel } from './PluginActions'
import { PluginDiagnostics } from './PluginDiagnostics'
import { PluginIcon } from './PluginIcon'
import { PluginStatusBadge } from './PluginStatusBadge'
import type { PluginItemHandlers } from './PluginActions'
import type { PluginOperation } from '@/api/hooks/usePlugins'
import type { PluginInfo } from '@/api/types/plugins.types'
import { Card } from '@/components/ui/card'
import { P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

interface PluginCardProps extends PluginItemHandlers {
  plugin: PluginInfo
  operation: PluginOperation | undefined
}

export function PluginCard({
  plugin,
  operation,
  ...handlers
}: PluginCardProps) {
  const { t } = useTranslation('plugins')
  const busyLabel = usePluginBusyLabel(operation)

  // plugin.updatedAt is Z-suffixed UTC; don't route through serverTimeToLocal.
  const updatedTimeAgo = plugin.updatedAt
    ? formatDistanceToNow(new Date(plugin.updatedAt), { addSuffix: true })
    : null
  const hasDiagnostics = !!plugin.errorDetail || plugin.status === 'errored'
  const version =
    plugin.version ??
    (plugin.latestVersion !== 'unknown' ? plugin.latestVersion : null)

  return (
    <Card
      className={cn(
        'group w-full gap-0 py-0 transition-colors hover:border-primary/30',
        hasDiagnostics &&
          (plugin.errorSeverity === 'warning'
            ? 'border-amber-200 dark:border-amber-800'
            : 'border-red-200 dark:border-red-800'),
      )}
    >
      <div
        className={cn(
          'flex flex-1 flex-col gap-4 p-5',
          plugin.isInstalled && !plugin.isEnabled && 'opacity-70',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <PluginIcon plugin={plugin} />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">
                {plugin.name}
              </h3>
              <P className="mt-0.5 truncate text-muted-foreground">
                {plugin.author}
              </P>
            </div>
          </div>
          <PluginStatusBadge
            status={plugin.status}
            hasUpdate={plugin.hasUpdate}
            severity={plugin.errorSeverity}
            isEnabled={plugin.isEnabled}
            busyLabel={busyLabel}
            className="shrink-0"
          />
        </div>

        <P className="line-clamp-2 min-h-10 text-muted-foreground">
          {plugin.description}
        </P>

        {plugin.errorDetail && (
          <PluginDiagnostics errors={plugin.errorDetail} className="py-2" />
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2">
          {version && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-medium text-muted-foreground">
              {t('item.version', { version })}
            </span>
          )}
          {plugin.hasUpdate && plugin.latestVersion && (
            <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 font-mono text-sm font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              {t('card.versionArrow', { version: plugin.latestVersion })}
            </span>
          )}
          {plugin.capabilities.length > 0 && (
            <CapabilityBadges capabilities={plugin.capabilities} />
          )}
          {updatedTimeAgo && (
            <span className="text-sm text-muted-foreground">
              {t('card.updatedAgo', { time: updatedTimeAgo })}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center border-t border-border/60 px-5 py-3">
        <PluginActions
          plugin={plugin}
          operation={operation}
          layout="card"
          {...handlers}
        />
      </div>
    </Card>
  )
}
