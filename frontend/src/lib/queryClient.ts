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
import i18n from 'i18next'
import { createLogger } from './logger'
import { showToast } from './toast'
import { ApiClientError } from '@/api/client'
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

    // Provide specific message for 403 errors (ownership enforcement)
    if (error instanceof ApiClientError && error.status === 403) {
      showToast.error(
        i18n.t('errors:toast.accessDenied'),
        i18n.t('errors:toast.accessDeniedView'),
      )
      return
    }

    // Only show a toast once the query already has data (a refetch or a query
    // backed by placeholderData), so initial loads can surface errors in their
    // own UI without a duplicate toast.
    if (query.state.data !== undefined) {
      showToast.error(
        i18n.t('errors:toast.refreshFailed'),
        error instanceof Error
          ? error.message
          : i18n.t('errors:toast.tryAgain'),
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

    // Provide specific messages for known HTTP status codes
    if (error instanceof ApiClientError) {
      if (error.status === 403) {
        showToast.error(
          i18n.t('errors:toast.accessDenied'),
          i18n.t('errors:toast.accessDeniedAction'),
        )
        return
      }
      if (error.status === 409) {
        showToast.error(
          i18n.t('errors:toast.conflictTitle'),
          i18n.t('errors:api.conflict'),
        )
        return
      }
    }

    // Show toast for all mutation failures since they represent user actions
    showToast.error(
      i18n.t('errors:toast.operationFailed'),
      error instanceof Error ? error.message : i18n.t('errors:toast.tryAgain'),
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
