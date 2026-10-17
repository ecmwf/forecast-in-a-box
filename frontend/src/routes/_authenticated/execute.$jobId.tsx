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
import { RunDetailPage } from '@/features/executions/components/RunDetailPage'

/** Search params for the execution detail page.
 * - `mimes` is a comma-joined list of active filter chips on the Outputs tab;
 *   missing/empty = "All".
 * - `dims` filters by split coordinates, e.g. `param=167,151;step=6`.
 * - `groupBy` controls how the Outputs grid is sectioned; `dim:<key>` groups
 *   by a split coordinate. Missing = flat. */
const searchSchema = z.object({
  mimes: z.string().optional(),
  dims: z.string().optional(),
  groupBy: z
    .union([
      z.enum(['block', 'mime', 'block-and-mime']),
      z.templateLiteral(['dim:', z.string()]),
    ])
    .optional(),
})

export const Route = createFileRoute('/_authenticated/execute/$jobId')({
  component: RunDetailPage,
  validateSearch: searchSchema,
})
