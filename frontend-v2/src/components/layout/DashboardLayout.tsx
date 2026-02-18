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
 * DashboardLayout Component
 *
 * Layout for authenticated dashboard pages
 */

import { useState } from 'react'
import { AppShell } from './AppShell'
import type { ReactNode } from 'react'
import { NotificationBanner } from '@/components/common/NotificationBanner'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

interface DashboardLayoutProps {
  children: ReactNode
  /** Optional notification message to show in the banner */
  notificationMessage?: string
  /** Optional link text for the notification banner */
  notificationLinkText?: string
  /** Optional link href for the notification banner */
  notificationLinkHref?: string
}

/**
 * Dashboard layout with authenticated header and notification banner
 */
export function DashboardLayout({
  children,
  notificationMessage,
  notificationLinkText,
  notificationLinkHref,
}: DashboardLayoutProps) {
  const [showNotification, setShowNotification] = useState(true)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)

  const notificationBanner =
    notificationMessage && showNotification ? (
      <NotificationBanner
        message={notificationMessage}
        linkText={notificationLinkText}
        linkHref={notificationLinkHref}
        onDismiss={() => setShowNotification(false)}
      />
    ) : undefined

  return (
    <AppShell
      showFooter
      useAuthenticatedHeader
      notificationBanner={notificationBanner}
    >
      <div
        className={cn(
          'min-h-full min-w-0 overflow-x-hidden',
          dashboardVariant === 'modern' && 'bg-muted/50',
        )}
      >
        {children}
      </div>
    </AppShell>
  )
}
