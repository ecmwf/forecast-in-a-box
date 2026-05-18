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
 * Status Query Hook
 * TanStack Query hook for fetching system status
 */

import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { StatusResponse, TrafficLightStatus } from '@/types/status.types'
import {
  computeTrafficLightStatus,
  getComponentStatusDetails,
  getTrafficLightLabelKey,
} from '@/types/status.types'
import { fetchStatus } from '@/api/endpoints/status'
import { useStatusStore } from '@/features/status/stores/statusStore'
import { QUERY_CONSTANTS } from '@/utils/constants.ts'

/**
 * Query key for status
 */
export const statusQueryKey = ['status'] as const

/**
 * Extended status data with computed properties
 */
export interface StatusData {
  /** Raw status response from API */
  status: StatusResponse | undefined
  /** Computed traffic light status (green/orange/red) */
  trafficLightStatus: TrafficLightStatus
  /** Human-readable label for the traffic light status */
  trafficLightLabel: string
  /** Detailed component status information */
  componentDetails: ReturnType<typeof getComponentStatusDetails>
  /** Whether all active systems are up */
  isAllUp: boolean
  /** Whether all active systems are down */
  isAllDown: boolean
  /** Whether there's a partial outage */
  isPartialOutage: boolean
  /** Version string from the API */
  version: string | undefined
}

/**
 * Hook to fetch and manage system status
 * Auto-refetches every 30 seconds
 * Returns computed traffic light status and component details
 */
export function useStatus() {
  const { t } = useTranslation('status')
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

  // Mirror query data into the Zustand store. Runs in an effect (not the
  // render body) so we never write to a store while rendering.
  useEffect(() => {
    if (query.data) {
      setStatus(query.data)
    }
  }, [query.data, setStatus])

  // Compute derived status data
  const statusData: StatusData = useMemo(() => {
    const trafficLightStatus = computeTrafficLightStatus(query.data)
    return {
      status: query.data,
      trafficLightStatus,
      trafficLightLabel: t(getTrafficLightLabelKey(trafficLightStatus)),
      componentDetails: getComponentStatusDetails(query.data),
      isAllUp: trafficLightStatus === 'green',
      isAllDown: trafficLightStatus === 'red',
      isPartialOutage: trafficLightStatus === 'orange',
      version: query.data?.version,
    }
  }, [query.data, t])

  return {
    // Query state
    data: query.data,
    error: query.error,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
    dataUpdatedAt: query.dataUpdatedAt,
    // Computed status data
    ...statusData,
  }
}
