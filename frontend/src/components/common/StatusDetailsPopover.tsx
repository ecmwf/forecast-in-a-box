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
 * StatusDetailsPopover Component
 *
 * Shows detailed component status information in a popover
 */

import { Activity, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { ComponentStatus, StatusComponent } from '@/types/status.types'
import { STATUS_COMPONENTS } from '@/types/status.types'
import { useStatus } from '@/api/hooks/useStatus'
import { SummaryPopover } from '@/components/common/SummaryPopover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface StatusDetailsPopoverProps {
  /** The trigger element */
  children: ReactNode
  /** Alignment of the popover */
  align?: 'start' | 'center' | 'end'
  /** Side of the popover */
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** i18n keys (common namespace) for each component's display label. */
const componentLabelKeys = {
  api: 'status.apiServer',
  cascade: 'status.cascade',
  ecmwf: 'status.ecmwfData',
  scheduler: 'status.scheduler',
  plugins: 'status.plugins',
} as const satisfies Record<StatusComponent, string>

/**
 * Get icon for a component
 */
function getComponentIcon(component: StatusComponent) {
  switch (component) {
    case 'api':
      return <Server className="h-3.5 w-3.5" />
    case 'scheduler':
      return <Activity className="h-3.5 w-3.5" />
    default:
      return <Server className="h-3.5 w-3.5" />
  }
}

const statusColors: Record<ComponentStatus, string> = {
  up: 'bg-emerald-500',
  down: 'bg-red-500',
  off: 'bg-muted-foreground/30',
}

const statusTextColors: Record<ComponentStatus, string> = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
  off: 'text-muted-foreground',
}

/** i18n keys (common namespace) for each status state. */
const statusLabelKeys = {
  up: 'status.componentUp',
  down: 'status.componentDown',
  off: 'status.componentOff',
} as const satisfies Record<ComponentStatus, string>

interface ComponentRowProps {
  component: StatusComponent
  status?: ComponentStatus
  isLoading?: boolean
}

/**
 * Renders a single component status row
 */
function ComponentRow({ component, status, isLoading }: ComponentRowProps) {
  const { t } = useTranslation('common')
  const isActive = status ? status !== 'off' : true

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-md px-2 py-1.5',
        !isLoading && !isActive && 'opacity-50',
        !isLoading && 'transition-colors hover:bg-muted/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">
          {getComponentIcon(component)}
        </span>
        <span className="text-sm">{t(componentLabelKeys[component])}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {isLoading ? (
          <>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/30" />
            <span className="text-sm text-muted-foreground">...</span>
          </>
        ) : status ? (
          <>
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                statusColors[status],
                status === 'up' && 'animate-pulse',
              )}
            />
            <span className={cn('text-sm', statusTextColors[status])}>
              {t(statusLabelKeys[status])}
            </span>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function StatusDetailsPopover({
  children,
  align = 'end',
  side = 'bottom',
}: StatusDetailsPopoverProps) {
  const { t } = useTranslation('common')
  const { componentDetails, version, refetch, isFetching, isLoading } =
    useStatus()

  // Show loading state when status is not yet determined
  const showLoading = isLoading && componentDetails.length === 0

  return (
    <SummaryPopover
      trigger={children}
      align={align}
      side={side}
      title={
        <>
          <Activity className="h-4 w-4 text-primary" />
          {t('status.title')}
        </>
      }
      headerAction={
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-6 w-6"
        >
          <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        </Button>
      }
      footer={
        version ? (
          <div className="border-t pt-2 text-center">
            <span className="font-mono text-sm text-muted-foreground">
              {version}
            </span>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-1">
        {showLoading
          ? STATUS_COMPONENTS.map((component) => (
              <ComponentRow key={component} component={component} isLoading />
            ))
          : componentDetails.map(({ component, status }) => (
              <ComponentRow
                key={component}
                component={component}
                status={status}
              />
            ))}
      </div>
    </SummaryPopover>
  )
}
