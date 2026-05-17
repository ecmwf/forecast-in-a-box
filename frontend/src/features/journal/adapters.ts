/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { JobExecutionDetail } from '@/api/types/job.types'
import type { ScheduleRunResponse } from '@/api/types/schedule.types'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
  FableRetrieveResponse,
} from '@/api/types/fable.types'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { getBlocksByKind, getFactory } from '@/api/types/fable.types'
import { stripSystemTags } from '@/lib/system-tags'

/** Title of the run's first source block. */
export function deriveModelLabel(
  builder: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): string | null {
  for (const { instance } of getBlocksByKind(builder, catalogue, 'source')) {
    const factory = getFactory(catalogue, instance.factory_id)
    if (factory) return factory.title
  }
  return null
}

/** Parse the wire progress string into a clamped 0–100 number. */
function parseProgress(progress: string | null): number {
  const value = parseFloat(progress ?? '') || 0
  return Math.min(Math.max(value, 0), 100)
}

/**
 * Distinct sink-block titles — the output kinds the configuration produces.
 * Taken from the sinks, not output MIME types: Cascade delivers finished
 * outputs as opaque `application/octet-stream`.
 */
export function deriveSinkKinds(
  builder: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): Array<string> {
  const titles: Array<string> = []
  for (const { instance } of getBlocksByKind(builder, catalogue, 'sink')) {
    const factory = getFactory(catalogue, instance.factory_id)
    if (factory) titles.push(factory.title)
  }
  return [...new Set(titles)]
}

interface RunDetailToViewModelInput {
  run: JobExecutionDetail
  /** Undefined until the blueprint query resolves. */
  blueprint: FableRetrieveResponse | undefined
  catalogue: BlockFactoryCatalogue | undefined
  isBookmarked: boolean
}

/** Map a run plus its blueprint to the shared view model. */
export function runDetailToViewModel({
  run,
  blueprint,
  catalogue,
  isBookmarked,
}: RunDetailToViewModelInput): ForecastRunViewModel {
  const builder = blueprint?.builder
  const canDeriveBlocks = builder !== undefined && catalogue !== undefined
  // Prefer the count of artifacts the run produced; fall back to the
  // configuration's sink-block count before any outputs exist.
  const producedOutputs = run.outputs ? Object.keys(run.outputs).length : 0
  const sinkCount = canDeriveBlocks
    ? getBlocksByKind(builder, catalogue, 'sink').length
    : 0

  return {
    runId: run.run_id,
    attemptCount: run.attempt_count,
    displayName: blueprint?.display_name?.trim() ?? '',
    displayDescription: blueprint?.display_description?.trim() || null,
    status: run.status,
    progress: parseProgress(run.progress),
    createdAt: run.created_at,
    modelLabel: canDeriveBlocks ? deriveModelLabel(builder, catalogue) : null,
    outputCount: producedOutputs || sinkCount,
    outputKinds: canDeriveBlocks ? deriveSinkKinds(builder, catalogue) : [],
    tags: stripSystemTags(blueprint?.tags),
    blueprintId: run.blueprint_id,
    // useForecastRuns overrides these once the schedule/preset lists resolve.
    fromPreset: false,
    scheduleName: null,
    isBookmarked,
  }
}

interface ScheduleRunToViewModelInput {
  run: ScheduleRunResponse
  /** The schedule's blueprint id — schedule runs do not carry their own. */
  blueprintId: string
  blueprint: FableRetrieveResponse | undefined
  catalogue: BlockFactoryCatalogue | undefined
  isBookmarked: boolean
}

/**
 * Map a schedule run to the shared view model. Schedule runs carry no
 * blueprint id, progress or outputs — those come from the schedule's blueprint.
 */
export function scheduleRunToViewModel({
  run,
  blueprintId,
  blueprint,
  catalogue,
  isBookmarked,
}: ScheduleRunToViewModelInput): ForecastRunViewModel {
  const builder = blueprint?.builder
  const canDeriveBlocks = builder !== undefined && catalogue !== undefined
  return {
    runId: run.run_id,
    attemptCount: run.attempt_count,
    displayName: blueprint?.display_name?.trim() ?? '',
    displayDescription: blueprint?.display_description?.trim() || null,
    status: run.status,
    progress: 0,
    createdAt: run.created_at,
    modelLabel: canDeriveBlocks ? deriveModelLabel(builder, catalogue) : null,
    outputCount: canDeriveBlocks
      ? getBlocksByKind(builder, catalogue, 'sink').length
      : 0,
    outputKinds: canDeriveBlocks ? deriveSinkKinds(builder, catalogue) : [],
    tags: stripSystemTags(blueprint?.tags),
    blueprintId,
    fromPreset: false,
    scheduleName: null,
    isBookmarked,
  }
}
