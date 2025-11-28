/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * TanStack Query configuration
 * Centralized setup for React Query client
 */

import { QueryClient } from '@tanstack/react-query'
import { QUERY_CONSTANTS } from '@/utils/constants'

/**
 * Default query options for all queries
 */
const defaultQueryOptions = {
  queries: {
    // Refetch on window focus in development, but not in production
    refetchOnWindowFocus: import.meta.env.DEV,
    // Retry failed requests 3 times with exponential backoff
    retry: QUERY_CONSTANTS.RETRY.DEFAULT,
    // Stale time: 30 seconds (data is considered fresh for this duration)
    staleTime: QUERY_CONSTANTS.STALE_TIMES.DEFAULT,
    // Cache time: 5 minutes (unused data is kept in cache for this duration)
    gcTime: QUERY_CONSTANTS.CACHE_TIMES.DEFAULT,
  },
}

/**
 * Create and configure the QueryClient instance
 */
export const queryClient = new QueryClient({
  defaultOptions: defaultQueryOptions,
})
