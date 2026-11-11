/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import { PluginDiagnostics } from './PluginDiagnostics'
import type { PluginBadgeKind, PluginInfo } from '@/api/types/plugins.types'
import { pluginBadgeKind } from '@/api/types/plugins.types'
import { P } from '@/components/base/typography'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Diagnostics listed on hover; the details page has the rest. */
const TOOLTIP_DIAGNOSTICS = 3

const KIND_CLASS: Record<PluginBadgeKind, string> = {
  loaded: '',
  disabled: 'text-muted-foreground',
  warning: 'text-amber-700 dark:text-amber-400',
  errored: 'text-danger',
  update: 'text-amber-700 dark:text-amber-400',
  available: 'text-muted-foreground',
}

interface PluginStatusTextProps {
  plugin: Pick<
    PluginInfo,
    | 'status'
    | 'isEnabled'
    | 'hasUpdate'
    | 'latestVersion'
    | 'errorDetail'
    | 'errorSeverity'
  >
  /** In-flight work, e.g. "Installing"; replaces the status. */
  busyLabel?: string
  /** Lists the diagnostics on hover; off where they show in full nearby. */
  hoverDiagnostics?: boolean
}

/** A plugin's status as plain text, explained on hover with its diagnostics. */
export function PluginStatusText({
  plugin,
  busyLabel,
  hoverDiagnostics = true,
}: PluginStatusTextProps) {
  const { t } = useTranslation('plugins')

  if (busyLabel !== undefined) {
    return <span className="text-sm text-muted-foreground">{busyLabel}</span>
  }

  // Shared with the status filter so the two can't drift.
  const kind = pluginBadgeKind(plugin)
  const label: Record<PluginBadgeKind, string> = {
    loaded: t('status.loaded'),
    disabled: t('status.disabled'),
    warning: t('status.warning'),
    errored: t('status.errored'),
    update: t('status.updateAvailable'),
    available: t('status.available'),
  }
  const diagnostics = plugin.errorDetail ?? []
  const shown = hoverDiagnostics
    ? diagnostics.slice(0, TOOLTIP_DIAGNOSTICS)
    : []
  const hiddenCount = diagnostics.length - shown.length
  // Warnings and errors explain themselves through their diagnostics.
  const hint: string | null = {
    loaded: t('statusHint.loaded'),
    disabled: t('statusHint.disabled'),
    warning: null,
    errored: diagnostics.length > 0 ? null : t('statusHint.errored'),
    update: plugin.latestVersion
      ? t('statusHint.update', { version: plugin.latestVersion })
      : t('statusHint.updateUnknown'),
    available: t('statusHint.available'),
  }[kind]

  // Nothing to explain on hover: no underline, no tooltip.
  if (!hint && shown.length === 0) {
    return (
      <span className={cn('text-sm', KIND_CLASS[kind])}>{label[kind]}</span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'cursor-default text-sm underline decoration-dotted underline-offset-4',
              KIND_CLASS[kind],
            )}
          />
        }
      >
        {label[kind]}
      </TooltipTrigger>
      <TooltipContent>
        {/* No width of its own: TooltipContent already caps it. */}
        <div className="min-w-0 space-y-1">
          {hint && <P className="text-xs text-inherit">{hint}</P>}
          {shown.length > 0 && (
            <>
              <PluginDiagnostics errors={shown} plain />
              <P className="text-xs text-inherit opacity-70">
                {hiddenCount > 0
                  ? t('diagnostics.moreAndSeeDetails', { count: hiddenCount })
                  : t('diagnostics.seeDetails')}
              </P>
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
