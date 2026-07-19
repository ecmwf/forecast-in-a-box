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
import { ComparePage } from '@/features/compare/components/ComparePage'

/**
 * Visualisation URL state — the shareable projection of a view.
 * `a`/`b` are entry refs (`run:<jobId>~<taskId>` | `path:<path>` |
 * `wms:<url>`); `b` may also be the literal `off` (deliberate
 * single-source view, see SLOT_B_OFF). The basket itself is localStorage,
 * and lens ids/ports are runtime-only. Unlike other routes, `a`/`b` are
 * deliberately always materialized once sources are active: the "default
 * pair" depends on client-local basket state, so a shared URL must pin it
 * explicitly.
 */
const visualiseSearchSchema = z.object({
  a: z.string().optional(),
  b: z.string().optional(),
  mode: z.enum(['swipe', 'side', 'flicker', 'spy', 'blend']).optional(),
})

export const Route = createFileRoute('/_authenticated/visualise')({
  component: ComparePage,
  validateSearch: visualiseSearchSchema,
})
