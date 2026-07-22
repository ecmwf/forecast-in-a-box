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
 * Removal is the lens lifecycle boundary: dropping a source from the
 * basket stops the lens instances serving its directory — unless another
 * remaining entry still resolves there. Directories come from the query
 * cache (an unresolved output never started a lens through this page).
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import { storedDirQueryOptions } from '@/features/executions/outputs/stored-dir'
import { createLogger } from '@/lib/logger'
import { lensKeys, useStopLens } from '@/api/hooks/useLens'

const log = createLogger('useStopOrphanedLenses')

/** Structural minimum — accepts basket entries with or without `addedAt`. */
type EntryLike =
  | { kind: 'path'; path: string }
  | { kind: 'output'; jobId: string; taskId: string }
  | { kind: 'wms'; url: string }

export function useStopOrphanedLenses(): (
  removed: ReadonlyArray<EntryLike>,
  remaining: ReadonlyArray<EntryLike>,
) => Promise<void> {
  const queryClient = useQueryClient()
  const stopMutation = useStopLens()

  return useCallback(
    async (removed, remaining) => {
      const pathOf = async (entry: EntryLike): Promise<string | null> => {
        if (entry.kind === 'path') return entry.path
        if (entry.kind === 'output') {
          return queryClient
            .ensureQueryData(storedDirQueryOptions(entry.jobId, entry.taskId))
            .catch((err: unknown) => {
              log.debug('Output dir unresolved; lens kept', { error: err })
              return null
            })
        }
        return null
      }
      const keep = new Set(
        (await Promise.all(remaining.map(pathOf))).filter(
          (p): p is string => p !== null,
        ),
      )
      const lenses =
        queryClient.getQueryData<Array<LensInstanceDetailResponse>>(
          lensKeys.list(),
        ) ?? []
      for (const entry of removed) {
        const path = await pathOf(entry)
        if (!path || keep.has(path)) continue
        for (const lens of lenses) {
          if (lens.lens_params.local_path !== path) continue
          if (lens.status !== 'running' && lens.status !== 'starting') continue
          stopMutation.mutate({ lensInstanceId: lens.lens_instance_id })
        }
      }
    },
    [queryClient, stopMutation],
  )
}
