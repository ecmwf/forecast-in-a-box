/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { formatDistanceToNowStrict } from 'date-fns'
import { AlertCircle, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PluginActions, usePluginBusyLabel } from './PluginActions'
import { PluginDiagnostics } from './PluginDiagnostics'
import { PluginIcon } from './PluginIcon'
import type { PluginItemHandlers } from './PluginActions'
import type { PluginOperation } from '@/api/hooks/usePlugins'
import type { PluginInfo } from '@/api/types/plugins.types'
import { PluginStatusBadge } from '@/features/plugins/components/PluginStatusBadge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { H4, P } from '@/components/base/typography'
import { CatalogueRow } from '@/components/common/catalogue/CatalogueView'
import { cn } from '@/lib/utils'

interface PluginRowProps extends PluginItemHandlers {
  plugin: PluginInfo
  operation: PluginOperation | undefined
}

export function PluginRow({ plugin, operation, ...handlers }: PluginRowProps) {
  const { t } = useTranslation('plugins')
  const busyLabel = usePluginBusyLabel(operation)

  // plugin.updatedAt is Z-suffixed UTC; don't route through serverTimeToLocal.
  const updatedTimeAgo = plugin.updatedAt
    ? formatDistanceToNowStrict(new Date(plugin.updatedAt), {
        addSuffix: true,
      })
    : null

  // Any diagnostic, or a bare `errored` state; severity (below) picks amber vs red.
  const hasDiagnostics = !!plugin.errorDetail || plugin.status === 'errored'
  const isWarningOnly = plugin.errorSeverity === 'warning'
  const version =
    plugin.version ??
    (plugin.latestVersion !== 'unknown' ? plugin.latestVersion : null)

  // Entry count, not a character guess: each entry is separately clamped, so
  // the tooltip height is bounded without ever cutting the list mid-line.
  const tooltipDiagnostics = plugin.errorDetail?.slice(0, 3)
  const hiddenDiagnostics =
    (plugin.errorDetail?.length ?? 0) - (tooltipDiagnostics?.length ?? 0)

  return (
    <CatalogueRow
      className={cn(
        hasDiagnostics &&
          (isWarningOnly
            ? 'bg-amber-50/50 dark:bg-amber-950/20'
            : 'bg-red-50/50 dark:bg-red-950/20'),
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-start gap-3',
          plugin.isInstalled && !plugin.isEnabled && 'opacity-70',
        )}
      >
        <PluginIcon plugin={plugin} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <H4 className="truncate text-sm font-semibold">{plugin.name}</H4>
            {hasDiagnostics && (
              <Tooltip>
                <TooltipTrigger>
                  {isWarningOnly ? (
                    <TriangleAlert className="h-4 w-4 text-amber-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {plugin.errorDetail && tooltipDiagnostics ? (
                    // No width of its own: TooltipContent already caps the
                    // width, and a nested max-w-xs overflows its px-3 padding.
                    <div className="min-w-0">
                      <PluginDiagnostics errors={tooltipDiagnostics} plain />
                      <P className="mt-1 text-xs text-inherit opacity-70">
                        {hiddenDiagnostics > 0
                          ? t('diagnostics.moreAndSeeDetails', {
                              count: hiddenDiagnostics,
                            })
                          : t('diagnostics.seeDetails')}
                      </P>
                    </div>
                  ) : (
                    <P className="min-w-0 text-xs text-inherit">
                      {t('status.errored')}
                    </P>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <P className="mt-0.5 truncate text-muted-foreground">
            {t('row.byline', {
              author: plugin.author,
              description: plugin.description,
            })}
          </P>
        </div>
      </div>

      <div className="hidden min-w-0 lg:block">
        {updatedTimeAgo && (
          <div className="truncate text-sm">{updatedTimeAgo}</div>
        )}
        {version && (
          <div className="font-mono text-sm text-muted-foreground">
            {t('item.version', { version })}
            {plugin.hasUpdate && plugin.latestVersion && (
              <span className="ml-1 text-amber-700 dark:text-amber-400">
                {t('card.versionArrow', { version: plugin.latestVersion })}
              </span>
            )}
          </div>
        )}
      </div>

      <div>
        <PluginStatusBadge
          status={plugin.status}
          hasUpdate={plugin.hasUpdate}
          severity={plugin.errorSeverity}
          isEnabled={plugin.isEnabled}
          busyLabel={busyLabel}
        />
      </div>

      <PluginActions
        plugin={plugin}
        operation={operation}
        layout="row"
        {...handlers}
      />
    </CatalogueRow>
  )
}
