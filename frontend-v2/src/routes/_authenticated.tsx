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
 * Authenticated Layout Route
 *
 * Wraps all authenticated routes with authentication check and layout.
 *
 * In authenticated mode: Uses beforeLoad to redirect logged-out users to home page.
 * In anonymous mode: Users are always authenticated and have full access.
 */

import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { DashboardLayout } from '@/components/layout'
import { useConfigStore } from '@/stores/configStore'
import { checkSession } from '@/api/endpoints/auth'
import { createLogger } from '@/lib/logger'
import { isValidInternalRedirect } from '@/lib/utils'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const log = createLogger('AuthRoute')

/**
 * Check if user is logged out (synchronously checks localStorage)
 *
 * Note: In anonymous mode, this flag is never set, so users are always "logged in"
 */
function isLoggedOut(): boolean {
  return localStorage.getItem(STORAGE_KEYS.auth.logoutFlag) === 'true'
}

/**
 * Check if user is authenticated in anonymous mode
 */
function isAnonymousUser(): boolean {
  return !!localStorage.getItem(STORAGE_KEYS.auth.anonymousId)
}

/**
 * Authenticated layout component
 */
function AuthenticatedLayout() {
  const { t } = useTranslation('dashboard')

  return (
    <DashboardLayout
      notificationMessage={t('notification.newModels')}
      notificationLinkText={t('notification.registryLink')}
      notificationLinkHref="#"
    >
      <Outlet />
    </DashboardLayout>
  )
}

export const Route = createFileRoute('/_authenticated')({
  // Check authentication before loading the route
  beforeLoad: async ({ location }) => {
    log.debug('beforeLoad - checking auth...')

    // Get current config
    const config = useConfigStore.getState().config
    const authType = config?.authType || 'anonymous'

    log.debug('Auth type:', authType)

    // In anonymous mode, check for anonymous user ID (logout flag doesn't apply)
    if (authType === 'anonymous') {
      if (isAnonymousUser()) {
        log.debug('Anonymous user detected, allowing access')
        return
      } else {
        log.info('Anonymous mode but no user ID, redirecting to home')
        throw redirect({
          to: '/',
        })
      }
    }

    // In authenticated mode, check for logout flag and valid session
    // If user explicitly logged out, redirect to home page
    if (isLoggedOut()) {
      log.info('User explicitly logged out, redirecting to home')
      // Only store redirect if it's a valid internal path (prevents open redirect attacks)
      if (isValidInternalRedirect(location.href)) {
        localStorage.setItem(STORAGE_KEYS.auth.redirectUrl, location.href)
      }

      throw redirect({
        to: '/',
      })
    }

    log.debug('Checking session validity...')
    const hasValidSession = await checkSession()

    if (!hasValidSession) {
      log.info('No valid session, redirecting to home for login')
      // Only store redirect if it's a valid internal path (prevents open redirect attacks)
      if (isValidInternalRedirect(location.href)) {
        localStorage.setItem(STORAGE_KEYS.auth.redirectUrl, location.href)
      }

      throw redirect({
        to: '/',
      })
    }

    log.debug('Valid session found, allowing access')
  },
  component: AuthenticatedLayout,
})
