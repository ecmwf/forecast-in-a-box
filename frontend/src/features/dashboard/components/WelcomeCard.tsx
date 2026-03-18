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
 * WelcomeCard Component
 *
 * Welcome section with stats grid and quick action buttons
 */

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
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { StatCard } from './StatCard'
import { QuickActionButton } from './QuickActionButton'
import { JobStatusDetailsPopover } from './JobStatusDetailsPopover'
import type { ReactNode } from 'react'
import type { TrafficLightStatus } from '@/types/status.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { mockDashboardStats } from '@/features/dashboard/data/mockData'
import { useStatus } from '@/api/hooks/useStatus'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/features/auth/AuthContext'
import { H2 } from '@/components/base/typography'
import { cn } from '@/lib/utils'
import { useUser } from '@/hooks/useUser'

function getUserDisplayName(email?: string): string {
  if (!email) return 'User'
  // Extract name from email (e.g., "john.doe@example.com" -> "John")
  const localPart = email.split('@')[0]
  if (!localPart) return 'User'
  const firstName = localPart.split('.')[0]
  if (!firstName) return 'User'
  return firstName.charAt(0).toUpperCase() + firstName.slice(1)
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
  const { runningCount, isLoading: isJobCountLoading } = useJobStatusCounts()
  const { authType } = useAuth()

  const isAnonymous = authType === 'anonymous'
  const displayName = getUserDisplayName(user?.email)
  const stats = mockDashboardStats

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

          {/* Currently Running */}
          <JobStatusDetailsPopover align="start">
            <StatCard
              label={t('welcome.stats.currentlyRunning')}
              icon={<Clock className="h-4 w-4" />}
              value={
                <>
                  {isJobCountLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-lg font-semibold">
                      {runningCount}
                    </span>
                  )}
                  {runningCount > 0 && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  )}
                </>
              }
              subtext={t('welcome.stats.activeForecasts')}
              className="cursor-pointer transition-colors hover:bg-muted/80"
            />
          </JobStatusDetailsPopover>

          {/* Available Models */}
          <StatCard
            label={t('welcome.stats.availableModels')}
            icon={<Box className="h-4 w-4" />}
            value={
              <span className="text-lg font-semibold">
                {stats.availableModels}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  {t('welcome.stats.of', { total: stats.totalModels })}
                </span>
              </span>
            }
            subtext={t('welcome.stats.downloadedModels')}
          />

          {/* Total Forecasts */}
          <StatCard
            label={t('welcome.stats.totalForecasts')}
            icon={<TrendingUp className="h-4 w-4" />}
            value={
              <>
                <span className="text-lg font-semibold">
                  {stats.totalForecasts.toLocaleString()}
                </span>
                <span className="flex items-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="h-3.5 w-3.5" />+{stats.forecastTrend}%
                </span>
              </>
            }
            subtext={t('welcome.stats.thisMonth')}
          />
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
        />
      </div>
    </Card>
  )
}
