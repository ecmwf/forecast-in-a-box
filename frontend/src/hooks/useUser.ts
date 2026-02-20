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
 * User Data Hook
 *
 * Fetches user data from the backend using the users API endpoint.
 * The backend is the single source of truth for user identity.
 *
 * Authentication is handled via:
 * - Session cookies (for authenticated mode)
 * - X-Anonymous-ID header (for anonymous mode)
 *
 * Both are managed automatically by apiClient.
 *
 * Usage:
 * ```typescript
 * const { data: user, isLoading, error } = useUser()
 *
 * if (user?.is_superuser) {
 *   // Show admin UI
 * }
 * ```
 */

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { getCurrentUser } from '@/api/endpoints/users'

/**
 * Hook to get current user data
 *
 * @returns TanStack Query result with user data
 */
export function useUser() {
  const { isAuthenticated, authType } = useAuth()

  return useQuery({
    queryKey: ['user', 'me', authType],
    queryFn: getCurrentUser,
    // Only fetch if authenticated
    enabled: isAuthenticated,
    retry: (failureCount, error) => {
      // Don't retry 401/403 errors
      if (error instanceof Error && error.message.includes('401')) return false
      if (error instanceof Error && error.message.includes('403')) return false
      return failureCount < 2
    },
    staleTime: 5 * 60 * 1000, // Cache user for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
  })
}
