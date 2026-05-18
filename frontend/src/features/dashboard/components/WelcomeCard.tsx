/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Welcome section with a stats grid and quick action buttons. */

import {
  Activity,
  AlertTriangle,
  Bookmark,
  Box,
  CheckCircle2,
  Clock,
  Loader2,
  Puzzle,
  Settings2,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { StatCard } from './StatCard'
import { QuickActionButton } from './QuickActionButton'
import { RunActivityPopover } from './RunActivityPopover'
import { RunStatusDetailsPopover } from './RunStatusDetailsPopover'
import { ModelSummaryPopover } from './ModelSummaryPopover'
import type { ReactNode } from 'react'
import type { TrafficLightStatus } from '@/types/status.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { useArtifacts } from '@/api/hooks/useArtifacts'
import { useStatus } from '@/api/hooks/useStatus'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { useServerTime } from '@/api/hooks/useSchedules'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/features/auth/AuthContext'
import { H2 } from '@/components/base/typography'
import { cn } from '@/lib/utils'
import { useUser } from '@/hooks/useUser'

/** Derive a display first name from an email, or null when none can be extracted. */
function getUserDisplayName(email?: string): string | null {
  if (!email) return null
  // Extract name from email (e.g., "john.doe@example.com" -> "John")
  const localPart = email.split('@')[0]
  if (!localPart) return null
  const firstName = localPart.split('.')[0]
  if (!firstName) return null
  return firstName.charAt(0).toUpperCase() + firstName.slice(1)
}

/**
 * Month-over-month change in forecast count; null when last month had none.
 *
 * `created_at` is naive server-local — `toLocalDate` corrects it before bucketing.
 */
function forecastTrend(
  runs: ReadonlyArray<{ created_at: string }>,
  toLocalDate: (serverTimeStr: string) => Date,
): number | null {
  const now = new Date()
  const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`
  const thisKey = monthKey(now)
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  let thisMonth = 0
  let lastMonth = 0
  for (const run of runs) {
    const key = monthKey(toLocalDate(run.created_at))
    if (key === thisKey) thisMonth += 1
    else if (key === lastKey) lastMonth += 1
  }
  return lastMonth === 0
    ? null
    : Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
}

/** Status icon for each traffic light status */
const statusIcons: Record<TrafficLightStatus, ReactNode> = {
  unknown: <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />,
  green: <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-emerald-500" />,
  orange: <AlertTriangle className="h-5 w-5 fill-amber-500 text-amber-500" />,
  red: <XCircle className="h-5 w-5 fill-red-500 text-red-500" />,
}

interface WelcomeCardProps {
  variant?: DashboardVariant
  shadow?: PanelShadow
  className?: string
}

export function WelcomeCard({ variant, shadow, className }: WelcomeCardProps) {
  const { data: user } = useUser()
  const { t } = useTranslation('dashboard')
  const { trafficLightStatus } = useStatus()
  const { serverTimeToLocal } = useServerTime()
  const {
    counts,
    total,
    runs,
    runningProgress,
    isLoading: isJobCountLoading,
  } = useJobStatusCounts()

  // Show the most advanced active state: running > preparing > submitted
  const activeStatus =
    counts.running > 0
      ? {
          label: t('welcome.stats.currently.running'),
          count: counts.running,
        }
      : counts.preparing > 0
        ? {
            label: t('welcome.stats.currently.preparing'),
            count: counts.preparing,
          }
        : {
            label: t('welcome.stats.currently.submitted'),
            count: counts.submitted,
          }
  const { authType } = useAuth()

  const { artifacts } = useArtifacts()

  const isAnonymous = authType === 'anonymous'
  const displayName =
    getUserDisplayName(user?.email) ?? t('welcome.userFallback')
  const trend = forecastTrend(runs, serverTimeToLocal)
  const downloadedModels = artifacts.filter((a) => a.isAvailable).length
  const totalModels = artifacts.length

  // Get status label and subtext based on traffic light status
  function getStatusText(): { label: string; subtext: string } {
    switch (trafficLightStatus) {
      case 'unknown':
        return {
          label: t('welcome.stats.checking'),
          subtext: t('welcome.stats.loadingStatus'),
        }
      case 'green':
        return {
          label: t('welcome.stats.allOk'),
          subtext: t('welcome.stats.operational'),
        }
      case 'orange':
        return {
          label: t('welcome.stats.partialOutage'),
          subtext: t('welcome.stats.someIssues'),
        }
      case 'red':
        return {
          label: t('welcome.stats.systemDown'),
          subtext: t('welcome.stats.notOperational'),
        }
    }
  }

  const statusDisplay = {
    icon: statusIcons[trafficLightStatus],
    ...getStatusText(),
  }

  return (
    <Card className={cn('p-6', className)} variant={variant} shadow={shadow}>
      <H2 className="mb-6 text-xl font-semibold">
        {isAnonymous
          ? t('welcome.titleAnonymous')
          : t('welcome.title', { name: displayName })}
      </H2>

      {/* Stats Grid */}
      <CardContent className="mb-6 p-0">
        <div className="grid grid-cols-2 gap-4">
          {/* System Status */}
          <StatusDetailsPopover align="start">
            <StatCard
              label={t('welcome.stats.systemStatus')}
              icon={<Activity className="h-4 w-4" />}
              value={
                <>
                  {statusDisplay.icon}
                  <span className="text-lg font-semibold">
                    {statusDisplay.label}
                  </span>
                </>
              }
              subtext={statusDisplay.subtext}
              className="cursor-pointer transition-colors hover:bg-muted/80"
            />
          </StatusDetailsPopover>

          {/* Currently Active */}
          <RunStatusDetailsPopover align="start">
            <StatCard
              label={activeStatus.label}
              icon={<Clock className="h-4 w-4" />}
              value={
                <>
                  {isJobCountLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-lg font-semibold">
                      {activeStatus.count}
                    </span>
                  )}
                  {activeStatus.count > 0 && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  )}
                  {counts.running > 0 && (
                    <span className="flex grow items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums">
                        {Math.round(runningProgress)}%
                      </span>
                      <span className="h-1.5 grow overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-amber-500 transition-all"
                          style={{ width: `${runningProgress}%` }}
                        />
                      </span>
                    </span>
                  )}
                </>
              }
              subtext={t('welcome.stats.activeForecasts')}
              className="cursor-pointer transition-colors hover:bg-muted/80"
            />
          </RunStatusDetailsPopover>

          {/* Available Models */}
          <ModelSummaryPopover align="start">
            <StatCard
              label={t('welcome.stats.availableModels')}
              icon={<Box className="h-4 w-4" />}
              value={
                <span className="text-lg font-semibold">
                  {downloadedModels}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    {t('welcome.stats.of', { total: totalModels })}
                  </span>
                </span>
              }
              subtext={t('welcome.stats.downloadedModels')}
              className="cursor-pointer transition-colors hover:bg-muted/80"
            />
          </ModelSummaryPopover>

          {/* Total Forecasts */}
          <RunActivityPopover align="start">
            <StatCard
              label={t('welcome.stats.totalForecasts')}
              icon={<TrendingUp className="h-4 w-4" />}
              value={
                <>
                  {isJobCountLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-lg font-semibold">
                      {total.toLocaleString()}
                    </span>
                  )}
                  {!isJobCountLoading && trend !== null && (
                    <span
                      className={cn(
                        'flex items-center text-sm font-medium',
                        trend >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400',
                      )}
                    >
                      {trend >= 0 ? (
                        <TrendingUp className="h-3.5 w-3.5" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5" />
                      )}
                      {trend >= 0 ? '+' : ''}
                      {trend}%
                    </span>
                  )}
                </>
              }
              subtext={t('welcome.stats.thisMonth')}
              className="cursor-pointer transition-colors hover:bg-muted/80"
            />
          </RunActivityPopover>
        </div>
      </CardContent>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <QuickActionButton
          icon={<Puzzle className="h-4 w-4" />}
          label={t('welcome.actions.managePlugins')}
          to="/admin/plugins"
        />
        <QuickActionButton
          icon={<Settings2 className="h-4 w-4" />}
          label={t('welcome.actions.manageExecutions')}
          to="/executions"
        />
        <QuickActionButton
          icon={<Bookmark className="h-4 w-4" />}
          label={t('welcome.actions.myPresets')}
          to="/presets"
        />
        <QuickActionButton
          icon={<Clock className="h-4 w-4" />}
          label={t('welcome.actions.scheduledForecasts')}
          to="/schedules"
        />
      </div>
    </Card>
  )
}
