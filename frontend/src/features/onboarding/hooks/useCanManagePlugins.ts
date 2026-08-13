/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useAuth } from '@/features/auth/AuthContext'
import { useUser } from '@/hooks/useUser'

/**
 * Whether the current user may visit /admin/plugins — the same rule the
 * admin route guard applies (anonymous mode: everyone; else superusers).
 */
export function useCanManagePlugins(): boolean {
  const { authType } = useAuth()
  const { data: user } = useUser()
  return authType === 'anonymous' || (user?.is_superuser ?? false)
}
