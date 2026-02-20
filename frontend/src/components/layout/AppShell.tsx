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
 * AppShell Component
 *
 * Main application shell with header, sidebar, and content area
 */

import { Header } from './Header'
import { AuthenticatedHeader } from './AuthenticatedHeader'
import { Footer } from './Footer'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

interface AppShellProps {
  children: ReactNode
  /** Whether to show the footer */
  showFooter?: boolean
  /** Whether to use authenticated header style */
  useAuthenticatedHeader?: boolean
  /** Optional notification banner to show above header */
  notificationBanner?: ReactNode
}

/**
 * Application shell layout component
 */
export function AppShell({
  children,
  showFooter = true,
  useAuthenticatedHeader = false,
  notificationBanner,
}: AppShellProps) {
  const layoutMode = useUiStore((state) => state.layoutMode)

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      {notificationBanner}
      {useAuthenticatedHeader ? <AuthenticatedHeader /> : <Header />}
      <div className="flex min-w-0 flex-1">
        <main
          className={cn(
            'min-w-0 flex-1',
            layoutMode === 'boxed' &&
              'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8',
          )}
        >
          {children}
        </main>
      </div>
      {showFooter && <Footer />}
    </div>
  )
}
