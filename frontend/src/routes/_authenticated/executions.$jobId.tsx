/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ExecutionDetailPage } from '@/features/executions/components/ExecutionDetailPage'

/** Search params for the execution detail page. `mimes` is a comma-joined
 * list of active filter chips on the Outputs tab; missing/empty = "All". */
const searchSchema = z.object({
  mimes: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/executions/$jobId')({
  component: ExecutionDetailPage,
  validateSearch: searchSchema,
})
