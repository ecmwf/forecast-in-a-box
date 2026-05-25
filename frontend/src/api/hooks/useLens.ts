/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import {
  getLensStatus,
  listLenses,
  startSkinnyWms,
  stopLens,
} from '@/api/endpoints/lens'

export const lensKeys = {
  all: ['lens'] as const,
  list: () => [...lensKeys.all, 'list'] as const,
  status: (id: string) => [...lensKeys.all, 'status', id] as const,
}

export function useLensList() {
  return useQuery<Array<LensInstanceDetailResponse>>({
    queryKey: lensKeys.list(),
    queryFn: () => listLenses(),
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
  })
}

export function useStartSkinnyWms() {
  const queryClient = useQueryClient()
  return useMutation<string, Error, { localPath: string }>({
    mutationFn: ({ localPath }) => startSkinnyWms(localPath),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lensKeys.list() })
    },
  })
}

/**
 * Polls the lens until it reaches a terminal state. Polling cadence:
 * 1 s while `starting`, stops once the instance is `running`, `failed`,
 * or `terminated` so we don't keep hitting the backend after success.
 */
export function useLensStatus(lensInstanceId: string | undefined) {
  return useQuery<LensInstanceDetailResponse>({
    queryKey: lensKeys.status(lensInstanceId ?? ''),
    queryFn: () => getLensStatus(lensInstanceId!),
    enabled: !!lensInstanceId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return 1000
      return status === 'starting' ? 1000 : false
    },
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useStopLens() {
  const queryClient = useQueryClient()
  return useMutation<string, Error, { lensInstanceId: string }>({
    mutationFn: ({ lensInstanceId }) => stopLens(lensInstanceId),
    onSettled: (_data, _error, { lensInstanceId }) => {
      void queryClient.invalidateQueries({
        queryKey: lensKeys.status(lensInstanceId),
      })
      void queryClient.invalidateQueries({ queryKey: lensKeys.list() })
    },
  })
}
