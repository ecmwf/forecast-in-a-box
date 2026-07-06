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
 * PluginDiagnostics Component
 *
 * Severity-coloured list of structured plugin errors, either bare (`plain`,
 * e.g. inside a tooltip) or wrapped in an alert styled by the max severity.
 */

import { AlertCircle, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import type {
  PluginError,
  PluginErrorSeverity,
} from '@/api/types/plugins.types'
import {
  normalizePluginErrorSeverity,
  pluginErrorsMaxSeverity,
} from '@/api/types/plugins.types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

const SEVERITY_ICONS: Record<
  PluginErrorSeverity,
  { Icon: LucideIcon; className: string }
> = {
  warning: { Icon: TriangleAlert, className: 'text-amber-500' },
  error: { Icon: AlertCircle, className: 'text-red-500' },
  critical: { Icon: OctagonAlert, className: 'text-red-700 dark:text-red-400' },
}

interface PluginDiagnosticsProps {
  errors: Array<PluginError>
  /** Render the bare list without the alert wrapper (e.g. inside a tooltip) */
  plain?: boolean
  className?: string
}

export function PluginDiagnostics({
  errors,
  plain = false,
  className,
}: PluginDiagnosticsProps) {
  const { t } = useTranslation('plugins')

  const sourceLabels: Record<string, string> = {
    install: t('diagnostics.source.install'),
    load: t('diagnostics.source.load'),
    template_ingest: t('diagnostics.source.template_ingest'),
  }

  const list = (
    <ul className={cn('flex flex-col gap-1.5', plain && className)}>
      {errors.map((error, index) => {
        const severity = normalizePluginErrorSeverity(error.severity)
        const { Icon, className: iconClass } = SEVERITY_ICONS[severity]
        return (
          <li key={index} className="flex items-start gap-1.5 text-xs">
            <Icon
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', iconClass)}
              aria-label={t(
                severity === 'warning'
                  ? 'diagnostics.severity.warning'
                  : severity === 'critical'
                    ? 'diagnostics.severity.critical'
                    : 'diagnostics.severity.error',
              )}
            />
            <span>
              <span className="font-medium">
                {sourceLabels[error.source] ?? error.source}
              </span>
              {' — '}
              {error.detail}
            </span>
          </li>
        )
      })}
    </ul>
  )

  if (plain) {
    return list
  }

  const isWarningOnly = pluginErrorsMaxSeverity(errors) === 'warning'

  return (
    <Alert
      variant={isWarningOnly ? 'default' : 'destructive'}
      className={cn(
        isWarningOnly &&
          'border-amber-300 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-900/10',
        className,
      )}
    >
      <AlertDescription className="text-xs">{list}</AlertDescription>
    </Alert>
  )
}
