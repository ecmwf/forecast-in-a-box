/**
 * Status hooks
 * Custom hooks for the status feature using TanStack Query
 */

import { useQuery } from '@tanstack/react-query'
import { fetchStatus } from '../api/statusApi'
import { useStatusStore } from '../stores/statusStore'
import type { StatusResponse } from '@/types/status.types'
import { QUERY_CONSTANTS } from '@/utils/constants.ts'

/**
 * Query key for status
 */
export const statusQueryKey = ['status'] as const

/**
 * Hook to fetch and manage system status
 * Auto-refetches every 30 seconds
 */
export function useStatus() {
  const setStatus = useStatusStore((state) => state.setStatus)

  const query = useQuery<StatusResponse>({
    queryKey: statusQueryKey,
    queryFn: fetchStatus,
    refetchInterval: QUERY_CONSTANTS.REFETCH_INTERVALS.STATUS,
    // Keep previous data while refetching
    placeholderData: (previousData) => previousData,
    // Refetch on window focus
    refetchOnWindowFocus: true,
  })

  // Update Zustand store when data changes
  if (query.data) {
    setStatus(query.data)
  }

  return query
}
