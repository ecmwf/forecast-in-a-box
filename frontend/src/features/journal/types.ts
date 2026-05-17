/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { JobStatus } from '@/api/types/job.types'

/**
 * The shape both run surfaces — the dashboard journal and /executions —
 * render. Built by the adapters from a raw run plus its blueprint.
 */
export interface ForecastRunViewModel {
  runId: string
  /** Latest attempt number; greater than 1 means the run was restarted. */
  attemptCount: number
  /** Blueprint name; empty until the blueprint loads. */
  displayName: string
  /** Optional blueprint description. */
  displayDescription: string | null
  status: JobStatus
  /** 0–100, only meaningful while running. */
  progress: number
  /** ISO creation timestamp. */
  createdAt: string
  /** First source block's title. */
  modelLabel: string | null
  /** Outputs the run produced, or the planned sink-block count. */
  outputCount: number
  /** Sink-block titles — the kinds of output the configuration produces. */
  outputKinds: Array<string>
  /** User tags, system markers stripped. */
  tags: Array<string>
  blueprintId: string
  /** The run's config was forked from a saved preset. */
  fromPreset: boolean
  /** Name of the schedule that produced this run, or null for one-off runs. */
  scheduleName: string | null
  isBookmarked: boolean
}

/** Status quick-filter tabs — a curated subset of `JobStatus`, plus `all`/`bookmarked`. */
export type RunFilter =
  | 'all'
  | 'submitted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'bookmarked'
