/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, delay, http } from 'msw'
import {
  calculateExpansion,
  mockCatalogue,
  mockSavedFables,
} from '../data/fable.data'
import { consumeCatalogueUnavailable } from './plugins.handlers'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'
import { API_ENDPOINTS } from '@/api/endpoints'

interface SavedFableEntry {
  fable: FableBuilderV1
  name: string
  tags: Array<string>
  user_id: string
  created_at: string
  updated_at: string
}

const savedFablesState: Record<string, SavedFableEntry | undefined> = {
  ...mockSavedFables,
}
let fableIdCounter = 100

export const fableHandlers = [
  http.get(API_ENDPOINTS.fable.catalogue, async () => {
    await delay(300)

    // Simulate 503 while plugins are reloading after install/uninstall/update
    if (consumeCatalogueUnavailable()) {
      return HttpResponse.json(
        { detail: 'Plugins are reloading, please retry' },
        { status: 503 },
      )
    }

    return HttpResponse.json(mockCatalogue)
  }),

  http.put(API_ENDPOINTS.fable.expand, async ({ request }) => {
    await delay(400)

    let fable: FableBuilderV1
    try {
      fable = (await request.json()) as FableBuilderV1
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    const expansion = calculateExpansion(fable)

    return HttpResponse.json(expansion)
  }),

  http.put(API_ENDPOINTS.fable.compile, async ({ request }) => {
    await delay(600)

    let fable: FableBuilderV1
    try {
      fable = (await request.json()) as FableBuilderV1
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    const expansion = calculateExpansion(fable)
    const hasErrors =
      expansion.global_errors.length > 0 ||
      Object.values(expansion.block_errors).some((errors) => errors.length > 0)

    if (hasErrors) {
      return HttpResponse.json(
        {
          message: 'Fable validation failed',
          errors: expansion,
        },
        { status: 422 },
      )
    }

    return HttpResponse.json({
      job_type: 'raw_cascade_job',
      job_instance: { tasks: {}, edges: [] },
      job_id: `job_${Date.now()}`,
    })
  }),

  http.get(API_ENDPOINTS.fable.retrieve, async ({ request }) => {
    await delay(300)

    const url = new URL(request.url)
    const fableId = url.searchParams.get('fable_builder_id')

    if (!fableId) {
      return HttpResponse.json(
        { message: 'Missing fable_builder_id parameter' },
        { status: 400 },
      )
    }

    const saved = savedFablesState[fableId]
    if (!saved) {
      return HttpResponse.json({ message: 'Fable not found' }, { status: 404 })
    }

    return HttpResponse.json(saved.fable)
  }),

  http.post(API_ENDPOINTS.fable.upsert, async ({ request }) => {
    await delay(500)

    const url = new URL(request.url)
    const existingId = url.searchParams.get('fable_builder_id')
    const tagsParam = url.searchParams.get('tags')
    const tags = tagsParam ? tagsParam.split(',') : []

    let fable: FableBuilderV1
    try {
      const body = (await request.json()) as { builder: FableBuilderV1 }
      fable = body.builder
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    for (const instance of Object.values(fable.blocks)) {
      const factory = getFactory(mockCatalogue, instance.factory_id)
      if (!factory) {
        const pluginDisplay = `${instance.factory_id.plugin.store}/${instance.factory_id.plugin.local}`
        return HttpResponse.json(
          {
            message: `Block factory '${pluginDisplay}:${instance.factory_id.factory}' not found`,
          },
          { status: 404 },
        )
      }
    }

    const now = new Date().toISOString()

    if (existingId) {
      const existing = savedFablesState[existingId]
      if (!existing) {
        return HttpResponse.json(
          { message: 'Fable not found' },
          { status: 404 },
        )
      }

      savedFablesState[existingId] = {
        ...existing,
        fable,
        tags: tags.length > 0 ? tags : existing.tags,
        updated_at: now,
      }

      return HttpResponse.json(existingId)
    }

    const newId = `fable-${String(fableIdCounter++).padStart(3, '0')}`

    savedFablesState[newId] = {
      fable,
      name: 'Untitled Configuration',
      tags,
      user_id: 'mock-user-123',
      created_at: now,
      updated_at: now,
    }

    return HttpResponse.json(newId)
  }),
]
