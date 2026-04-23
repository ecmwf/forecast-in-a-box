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
 * Admin Layout Route
 *
 * Wraps all admin routes with a shared layout and authorization check.
 * In anonymous/pass-through mode, all users are treated as admins.
 * In authenticated mode, only superusers can access admin routes.
 */

import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useConfigStore } from '@/stores/configStore'
import { getCurrentUser } from '@/api/endpoints/users'
import { queryClient } from '@/lib/queryClient'
import { showToast } from '@/lib/toast'
import { createLogger } from '@/lib/logger'

const log = createLogger('AdminRoute')

export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: async () => {
    const config = useConfigStore.getState().config
    const authType = config?.authType || 'anonymous'

    // In anonymous mode, all users have admin access (by design)
    if (authType === 'anonymous') {
      return
    }

    // In authenticated mode, verify superuser status. Go through the shared
    // query cache (matches the ['user', 'me', 'authenticated'] key used by
    // useUser()) so repeat admin navigations don't re-fetch /users/me.
    let user
    try {
      user = await queryClient.ensureQueryData({
        queryKey: ['user', 'me', 'authenticated'],
        queryFn: getCurrentUser,
        staleTime: 5 * 60 * 1000,
      })
    } catch (error) {
      log.error('Failed to verify admin access:', error)
      showToast.error('Could not verify admin access. Please try again.')
      throw redirect({ to: '/dashboard' })
    }

    if (!user.is_superuser) {
      log.warn('Non-superuser attempted to access admin route')
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
  return <Outlet />
}
