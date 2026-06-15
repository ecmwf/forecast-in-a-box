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
 * Lens API types — mirror `backend/src/forecastbox/routes/lens.py`.
 *
 * A lens is an external inspection tool (e.g. SkinnyWMS) launched against a
 * filesystem path produced by a sink block. The frontend starts a lens via
 * POST, polls its status until `running`, then mounts a viewer that talks
 * directly to the lens's exposed port.
 */

import { z } from 'zod'

export const LensStatusSchema = z.enum([
  'starting',
  'running',
  'terminated',
  'failed',
])

export type LensStatus = z.infer<typeof LensStatusSchema>

export const LensInstanceDetailResponseSchema = z.object({
  lens_instance_id: z.string(),
  status: LensStatusSchema,
  lens_name: z.string(),
  lens_params: z.record(z.string(), z.unknown()),
  ports: z.array(z.number()),
})

export type LensInstanceDetailResponse = z.infer<
  typeof LensInstanceDetailResponseSchema
>

export const SupportedLensDetailSchema = z.object({
  name: z.string(),
  route: z.string(),
  params: z.record(z.string(), z.string()),
})

export type SupportedLensDetail = z.infer<typeof SupportedLensDetailSchema>
