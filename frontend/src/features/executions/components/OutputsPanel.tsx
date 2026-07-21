/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { JobStatus, RunOutputs } from '@/api/types/job.types'
import type { LostTaskIds } from '@/features/executions/outputs/availability'
import { OutputsView } from '@/features/executions/outputs/OutputsView'

interface OutputsPanelProps {
  jobId: string
  status: JobStatus
  outputs: RunOutputs | null
  /** Reasons for outputs that are no longer retrievable. */
  lostTaskIds?: LostTaskIds
  /** Drive skeleton highlights for blocks currently being processed. */
  completedBlockIds?: ReadonlyArray<string> | null
  /** Used to show block-level skeletons before any outputs payload arrives. */
  plannedBlockIds?: ReadonlyArray<string> | null
  /** Portal target so the filter row can sit alongside the parent's tabs. */
  toolbarSlot?: HTMLElement | null
}

export function OutputsPanel({
  jobId,
  status,
  outputs,
  lostTaskIds,
  completedBlockIds,
  plannedBlockIds,
  toolbarSlot,
}: OutputsPanelProps) {
  return (
    // Remount per job so sniffed-mime and open-viewer state never leak across
    // executions — task ids are only unique within a single job.
    <OutputsView
      key={jobId}
      jobId={jobId}
      status={status}
      outputs={outputs}
      lostTaskIds={lostTaskIds}
      completedBlockIds={completedBlockIds}
      plannedBlockIds={plannedBlockIds}
      toolbarSlot={toolbarSlot}
    />
  )
}
