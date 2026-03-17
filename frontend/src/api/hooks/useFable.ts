/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
  FableCompileV2Request,
  FableUpsertV2Response,
  FableValidationExpansion,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import type { ExecutionSpecification } from '@/api/types/job.types'
import {
  compileFableV2,
  expandFable,
  getCatalogue,
  retrieveFableV2,
  upsertFableV2,
} from '@/api/endpoints/fable'
import { getFactory } from '@/api/types/fable.types'
import { ApiClientError } from '@/api/client'

export const fableKeys = {
  all: ['fable'] as const,
  catalogue: () => [...fableKeys.all, 'catalogue'] as const,
  detail: (id: string) => [...fableKeys.all, 'detail', id] as const,
  validation: (fable: FableBuilderV1) =>
    [...fableKeys.all, 'validation', JSON.stringify(fable)] as const,
}

export function useBlockCatalogue(language?: string) {
  return useQuery<BlockFactoryCatalogue>({
    queryKey: [...fableKeys.catalogue(), language],
    queryFn: () => getCatalogue(language),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: (failureCount, error) => {
      // Retry more on 503 (plugins temporarily unavailable after install/update)
      if (error instanceof ApiClientError && error.status === 503) {
        return failureCount < 5
      }
      return failureCount < 3
    },
    retryDelay: (attemptIndex, error) => {
      // Use fixed 1s delay for 503 since we just need to wait for plugins to load
      if (error instanceof ApiClientError && error.status === 503) {
        return 1000
      }
      return Math.min(1000 * 2 ** attemptIndex, 30000)
    },
  })
}

export function useFable(fableId: string | null | undefined) {
  return useQuery<FableBuilderV1>({
    queryKey: fableKeys.detail(fableId ?? ''),
    queryFn: async () => {
      const response = await retrieveFableV2(fableId!)
      return response.builder
    },
    enabled: !!fableId,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useExpandFable() {
  return useMutation<FableValidationExpansion, Error, FableBuilderV1>({
    mutationFn: expandFable,
  })
}

export function useFableValidation(
  fable: FableBuilderV1 | null,
  enabled: boolean = true,
) {
  const stableFable = useMemo(
    () => fable ?? ({ blocks: {} } as FableBuilderV1),
    [fable],
  )

  const hasBlocks = fable !== null && Object.keys(fable.blocks).length > 0

  return useQuery<FableValidationExpansion, Error>({
    queryKey: fableKeys.validation(stableFable),
    queryFn: () => expandFable(stableFable),
    enabled: enabled && hasBlocks,
    staleTime: 10 * 1000, // 10 seconds
    refetchOnWindowFocus: false,
    retry: false, // Don't retry on validation errors
  })
}

export function useCompileFableV2() {
  return useMutation<ExecutionSpecification, Error, FableCompileV2Request>({
    mutationFn: compileFableV2,
  })
}

export function useUpsertFable() {
  const queryClient = useQueryClient()

  return useMutation<
    FableUpsertV2Response,
    Error,
    {
      fable: FableBuilderV1
      fableId?: string
      display_name: string
      display_description: string
      tags?: Array<string>
    }
  >({
    mutationFn: ({ fable, fableId, display_name, display_description, tags }) =>
      upsertFableV2({
        builder: fable,
        display_name,
        display_description,
        tags: tags ?? [],
        parent_id: fableId,
      }),
    onSuccess: (result, variables) => {
      if (variables.fableId) {
        queryClient.invalidateQueries({
          queryKey: fableKeys.detail(variables.fableId),
        })
      }
      queryClient.invalidateQueries({ queryKey: fableKeys.detail(result.id) })
    },
  })
}

export function useBlockFactory(
  factoryId: PluginBlockFactoryId | null | undefined,
) {
  const { data: catalogue, isLoading, error } = useBlockCatalogue()

  const factory =
    factoryId && catalogue ? getFactory(catalogue, factoryId) : undefined

  return {
    factory,
    isLoading,
    error,
    notFound: !isLoading && factoryId && !factory,
  }
}
