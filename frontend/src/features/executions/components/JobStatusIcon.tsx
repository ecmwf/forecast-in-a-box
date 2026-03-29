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
 * JobStatusIcon Component
 *
 * Shared status icon for job execution status display.
 */

import { AlertCircle, CheckCircle2, Hourglass, Loader2 } from 'lucide-react'
import type { JobStatus } from '@/api/types/job.types'

export function JobStatusIcon({ status }: { status: JobStatus }) {
  switch (status) {
    case 'submitted':
    case 'preparing':
      return <Hourglass className="h-5 w-5 text-blue-500" />
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
    case 'completed':
      return (
        <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-emerald-500" />
      )
    case 'failed':
      return <AlertCircle className="h-5 w-5 fill-red-500 text-red-500" />
  }
}
