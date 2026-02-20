/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { P } from '@/components/base/typography'
import { FiabStackSection } from '@/features/landing/components/FiabStackSection.tsx'
import { IntroGlobeSection } from '@/features/landing/components/IntroGlobeSection.tsx'
import { Collaboration } from '@/features/landing/components/Collaboration.tsx'
import { PublicLayout } from '@/components/layout'
import { useAuth } from '@/features/auth/AuthContext'
import { createLogger } from '@/lib/logger'
import { isValidInternalRedirect } from '@/lib/utils'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const log = createLogger('Landing')

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { isAuthenticated, isLoading } = useAuth()

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      log.info('User is authenticated, redirecting to dashboard')

      // Check for stored redirect (validate to prevent open redirect attacks)
      const storedRedirect = localStorage.getItem(STORAGE_KEYS.auth.redirectUrl)
      localStorage.removeItem(STORAGE_KEYS.auth.redirectUrl) // Always clear after reading

      if (storedRedirect && isValidInternalRedirect(storedRedirect)) {
        log.info('Redirecting to stored location:', storedRedirect)
        window.location.href = storedRedirect
      } else if (storedRedirect) {
        // Log if a redirect was present but invalid
        log.warn('Invalid redirect URL blocked:', storedRedirect)
      }

      // Default redirect to dashboard
      log.info('Redirecting to /dashboard')
      window.location.href = '/dashboard'
    }
  }, [isLoading, isAuthenticated])

  // Show loading while checking auth
  if (isLoading) {
    log.debug('Checking authentication...')
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          </div>
          <P className="text-muted-foreground">Loading...</P>
        </div>
      </div>
    )
  }

  // If authenticated, don't render content (redirect is happening in useEffect)
  if (isAuthenticated) {
    log.debug('Waiting for redirect...')
    return null
  }

  // Show public landing page for unauthenticated users
  log.debug('Showing public landing page')
  return (
    <PublicLayout>
      <IntroGlobeSection />
      <FiabStackSection />
      <Collaboration />
    </PublicLayout>
  )
}
