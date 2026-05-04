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
import { OutputsView } from '@/features/executions/outputs/OutputsView'

interface OutputsPanelProps {
  jobId: string
  status: JobStatus
  outputs: RunOutputs | null
  /** DOM node to portal the toolbar into. Lifted out of the panel so the
   * filter row can sit alongside the parent's tab triggers. */
  toolbarSlot?: HTMLElement | null
}

export function OutputsPanel({
  jobId,
  status,
  outputs,
  toolbarSlot,
}: OutputsPanelProps) {
  return (
    <OutputsView
      jobId={jobId}
      status={status}
      outputs={outputs}
      toolbarSlot={toolbarSlot}
    />
  )
}
