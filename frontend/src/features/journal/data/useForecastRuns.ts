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
import { useQueries } from '@tanstack/react-query'
import type { JobExecutionDetail } from '@/api/types/job.types'
import type { FableRetrieveResponse } from '@/api/types/fable.types'
import type { ForecastRunViewModel } from '@/features/journal/types'
import {
  fableKeys,
  useBlockCatalogue,
  useListBlueprints,
} from '@/api/hooks/useFable'
import { useSchedules } from '@/api/hooks/useSchedules'
import { retrieveFable } from '@/api/endpoints/fable'
import { ApiClientError } from '@/api/client'
import { isOneoffBlueprint } from '@/lib/system-tags'
import { runDetailToViewModel } from '@/features/journal/adapters'
import { useRunFavourites } from '@/features/journal/hooks/useRunFavourites'

/**
 * Join runs with their blueprints, the block catalogue and the bookmark store
 * into the shared view model. The per-blueprint fetch is an N+1, deduplicated
 * by id and cache-shared with useFableRetrieve; backend enrichment would remove it.
 */
export function useForecastRuns(runs: ReadonlyArray<JobExecutionDetail>): {
  runs: Array<ForecastRunViewModel>
  toggleBookmark: (runId: string) => void
} {
  const { data: catalogue } = useBlockCatalogue()
  const { data: blueprintList } = useListBlueprints(1, 50)
  const { data: scheduleList } = useSchedules(1, 100)
  const { isBookmarked, toggleBookmark } = useRunFavourites()

  // Saved-preset ids — used to flag runs whose config was forked from one.
  const presetIds = useMemo(
    () =>
      new Set(
        (blueprintList?.blueprints ?? [])
          .filter(
            (bp) => bp.source === 'user_defined' && !isOneoffBlueprint(bp.tags),
          )
          .map((bp) => bp.blueprint_id),
      ),
    [blueprintList],
  )

  // A schedule's runs all carry its blueprint id, so map blueprint → schedule
  // name for the "Scheduled" chip and group-by-schedule. (/run/list carries no
  // experiment id; backend enrichment would make this exact.)
  const scheduleNameByBlueprint = useMemo(() => {
    const byBlueprint = new Map<string, string>()
    for (const schedule of scheduleList?.experiments ?? []) {
      byBlueprint.set(
        schedule.blueprint_id,
        schedule.display_name?.trim() ||
          `Schedule ${schedule.experiment_id.slice(0, 8)}`,
      )
    }
    return byBlueprint
  }, [scheduleList])

  const blueprintIds = useMemo(
    () => [...new Set(runs.map((run) => run.blueprint_id))],
    [runs],
  )

  const blueprintQueries = useQueries({
    queries: blueprintIds.map((id) => ({
      queryKey: [...fableKeys.detail(id), 'full'],
      queryFn: () => retrieveFable(id),
      staleTime: Infinity,
      // A deleted/missing blueprint (4xx) is final — don't retry it.
      retry: (failureCount: number, error: Error) =>
        error instanceof ApiClientError &&
        error.status != null &&
        error.status < 500
          ? false
          : failureCount < 2,
    })),
  })

  // One page of runs: cheap to rebuild each render, so no memo over the unstable useQueries result.
  const blueprintsById = new Map<string, FableRetrieveResponse>()
  blueprintIds.forEach((id, index) => {
    const data = blueprintQueries[index]?.data
    if (data) blueprintsById.set(id, data)
  })

  const viewModels = runs.map((run) => {
    const blueprint = blueprintsById.get(run.blueprint_id)
    const vm = runDetailToViewModel({
      run,
      blueprint,
      catalogue,
      isBookmarked: isBookmarked(run.run_id),
    })
    const parentId = blueprint?.parent_id
    return {
      ...vm,
      fromPreset: parentId != null && presetIds.has(parentId),
      scheduleName: scheduleNameByBlueprint.get(run.blueprint_id) ?? null,
    }
  })

  return { runs: viewModels, toggleBookmark }
}
