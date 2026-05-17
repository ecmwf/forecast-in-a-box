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
import { JobListPage } from '@/features/executions/components/JobListPage'

/** Journal URL state — search, status tab, grouping. Each omitted at its default to keep a bare /executions clean. */
const searchSchema = z.object({
  q: z.string().optional(),
  status: z
    .enum(['all', 'submitted', 'running', 'completed', 'failed', 'bookmarked'])
    .optional(),
  group: z.enum(['none', 'date', 'schedule', 'tag']).optional(),
})

export const Route = createFileRoute('/_authenticated/executions/')({
  component: JobListPage,
  validateSearch: searchSchema,
})
