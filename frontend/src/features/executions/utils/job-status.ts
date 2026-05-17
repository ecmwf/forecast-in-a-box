/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Job-status display helpers — each status resolves to a `StatusBadge` variant. */

import type { JobStatus } from '@/api/types/job.types'
import type { StatusBadgeVariant } from '@/components/common/StatusBadge'
import { JOB_STATUS_META } from '@/api/types/job.types'
import { STATUS_BADGE_VARIANTS } from '@/components/common/StatusBadge'

/** Job status → StatusBadge variant. */
const JOB_STATUS_VARIANT: Record<
  JobStatus,
  keyof typeof STATUS_BADGE_VARIANTS
> = {
  submitted: 'available',
  preparing: 'available',
  running: 'warning',
  completed: 'active',
  failed: 'error',
  unknown: 'disabled',
}

/** StatusBadge variant for a job status. */
export function getJobStatusVariant(status: JobStatus): StatusBadgeVariant {
  return {
    label: JOB_STATUS_META[status].label,
    ...STATUS_BADGE_VARIANTS[JOB_STATUS_VARIANT[status]],
  }
}

export function getStatusBadgeClasses(status: JobStatus): string {
  return getJobStatusVariant(status).badgeClass
}

export function getStatusBarColor(status: JobStatus): string {
  return getJobStatusVariant(status).barClass
}
