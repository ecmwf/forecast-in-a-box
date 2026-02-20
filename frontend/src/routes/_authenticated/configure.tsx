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
import { FableBuilderPage } from '@/features/fable-builder'

const searchSchema = z.object({
  preset: z
    .enum(['quick-start', 'standard', 'custom-model', 'dataset'])
    .optional(),
  state: z.string().optional(),
  fableId: z.string().optional(),
})

export type ConfigureSearch = z.infer<typeof searchSchema>

export const Route = createFileRoute('/_authenticated/configure')({
  validateSearch: searchSchema,
  component: ConfigurePage,
})

function ConfigurePage() {
  const { preset, state, fableId } = Route.useSearch()
  return (
    <FableBuilderPage
      key={fableId}
      fableId={fableId}
      preset={preset}
      encodedState={state}
    />
  )
}
