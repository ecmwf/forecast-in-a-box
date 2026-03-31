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
import type {
  FableBuilderV1,
  FableUpsertRequest,
} from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'
import { API_ENDPOINTS } from '@/api/endpoints'

interface SavedFableEntry {
  fable: FableBuilderV1
  name: string
  display_name: string | null
  display_description: string | null
  tags: Array<string>
  user_id: string
  created_at: string
  updated_at: string
}

const savedFablesState: Record<string, SavedFableEntry | undefined> =
  Object.fromEntries(
    Object.entries(mockSavedFables).map(([id, entry]) => [
      id,
      {
        ...entry,
        display_name: entry.name,
        display_description: '',
      },
    ]),
  )
let fableIdCounter = 100
const fableVersions: Record<string, number> = Object.fromEntries(
  Object.keys(mockSavedFables).map((id) => [id, 1]),
)

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

  http.post(API_ENDPOINTS.fable.create, async ({ request }) => {
    await delay(500)

    let body: FableUpsertRequest
    try {
      body = (await request.json()) as FableUpsertRequest
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    const { builder, display_name, display_description, tags, parent_id } = body

    for (const instance of Object.values(builder.blocks)) {
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

    if (parent_id) {
      const existing = savedFablesState[parent_id]
      if (!existing) {
        return HttpResponse.json(
          { message: 'Fable not found' },
          { status: 404 },
        )
      }

      const newVersion = (fableVersions[parent_id] ?? 1) + 1
      fableVersions[parent_id] = newVersion

      savedFablesState[parent_id] = {
        ...existing,
        fable: builder,
        display_name,
        display_description,
        tags: tags.length > 0 ? tags : existing.tags,
        updated_at: now,
      }

      return HttpResponse.json({
        job_definition_id: parent_id,
        version: newVersion,
      })
    }

    const newId = `fable-${String(fableIdCounter++).padStart(3, '0')}`
    fableVersions[newId] = 1

    savedFablesState[newId] = {
      fable: builder,
      name: display_name ?? '',
      display_name,
      display_description,
      tags,
      user_id: 'mock-user-123',
      created_at: now,
      updated_at: now,
    }

    return HttpResponse.json({ job_definition_id: newId, version: 1 })
  }),

  http.get(API_ENDPOINTS.fable.get, async ({ request }) => {
    await delay(300)

    const url = new URL(request.url)
    const fableId = url.searchParams.get('job_definition_id')

    if (!fableId) {
      return HttpResponse.json(
        { message: 'Missing job_definition_id parameter' },
        { status: 400 },
      )
    }

    const saved = savedFablesState[fableId]
    if (!saved) {
      return HttpResponse.json({ message: 'Fable not found' }, { status: 404 })
    }

    return HttpResponse.json({
      job_definition_id: fableId,
      version: fableVersions[fableId] ?? 1,
      builder: saved.fable,
      display_name: saved.display_name,
      display_description: saved.display_description,
      tags: saved.tags,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    })
  }),
]
