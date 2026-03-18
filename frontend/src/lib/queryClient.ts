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
 * TanStack Query configuration
 * Centralized setup for React Query client with global error handling
 */

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { createLogger } from './logger'
import { showToast } from './toast'
import { QUERY_CONSTANTS } from '@/utils/constants'

const log = createLogger('QueryClient')

/**
 * Global query cache with error handling.
 * Logs errors and optionally shows toast for failed queries.
 */
const queryCache = new QueryCache({
  onError: (error, query) => {
    log.error('Query failed:', {
      queryKey: query.queryKey,
      error: error instanceof Error ? error.message : error,
    })

    // Only show toast for queries that had data before (user-initiated refetches)
    // This avoids showing toasts for initial loads that might have their own error UI
    if (query.state.data !== undefined) {
      showToast.error(
        'Failed to refresh data',
        error instanceof Error ? error.message : 'Please try again',
      )
    }
  },
})

/**
 * Global mutation cache with error handling.
 * Logs errors and shows toast for failed mutations.
 */
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    log.error('Mutation failed:', {
      mutationKey: mutation.options.mutationKey,
      error: error instanceof Error ? error.message : error,
    })

    // Show toast for all mutation failures since they represent user actions
    showToast.error(
      'Operation failed',
      error instanceof Error ? error.message : 'Please try again',
    )
  },
})

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
 * Create and configure the QueryClient instance with global error handling
 */
export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: defaultQueryOptions,
})
