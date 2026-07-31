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
import { VisualisePage } from '@/features/visualise/components/VisualisePage'

/**
 * Visualisation URL state — the shareable projection of a view.
 * `a`/`b` are entry refs (`run:<jobId>~<taskId>` | `dir:<digest>` |
 * `wms:<url>` | `wmsp:<digest>`, see entry-ref.ts — host paths and
 * credentialed endpoints only ever appear as opaque digests); `b` may
 * also be the literal `off` (deliberate single-source view, see
 * SLOT_B_OFF). The basket itself is localStorage, and lens
 * ids/ports are runtime-only. Unlike other routes, `a`/`b` are
 * deliberately always materialized once sources are active: the "default
 * pair" depends on client-local basket state, so a shared URL must pin it
 * explicitly.
 *
 * The slim view state rides along so the copied URL reproduces the view,
 * not just the pair (encode/decode in view-url-state.ts): `la`/`lb`
 * active layer stacks (comma-joined names, top-first), `ul` unlinked
 * selection, `t` valid time (epoch ms), `tl`/`dt` time-link policy,
 * `cam` camera (lon,lat,zoom), `bm` basemap. Excluded by design:
 * annotations/overlays (unbounded — file export flows), opacities, the
 * time clip, independent-mode per-side instants. Every field `.catch`es
 * to absent — a malformed param degrades instead of failing the route.
 */
const visualiseSearchSchema = z.object({
  a: z.string().optional().catch(undefined),
  b: z.string().optional().catch(undefined),
  mode: z
    .enum(['swipe', 'side', 'flicker', 'spy', 'blend'])
    .optional()
    .catch(undefined),
  la: z.string().max(2000).optional().catch(undefined),
  lb: z.string().max(2000).optional().catch(undefined),
  ul: z.literal(true).optional().catch(undefined),
  t: z.number().int().optional().catch(undefined),
  tl: z.enum(['nearest', 'offset', 'independent']).optional().catch(undefined),
  dt: z.number().int().optional().catch(undefined),
  cam: z.string().max(64).optional().catch(undefined),
  bm: z.string().max(64).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/visualise')({
  component: VisualisePage,
  validateSearch: visualiseSearchSchema,
})
