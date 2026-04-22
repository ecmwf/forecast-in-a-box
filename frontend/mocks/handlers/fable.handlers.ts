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
  BlueprintUpdateRequest,
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

interface MockGlobalGlyph {
  global_glyph_id: string
  key: string
  value: string
  public: boolean
  overriddable: boolean | null
  created_by: string
  created_at: string
  updated_at: string
}

const mockGlobalGlyphs: Array<MockGlobalGlyph> = []
let glyphIdCounter = 1

const mockIntrinsicGlyphs = [
  {
    name: 'runId',
    display_name: 'Run ID',
    valueExample: '550e8400-e29b-41d4-a716-446655440000',
    created_by: 'intrinsic',
  },
  {
    name: 'submitDatetime',
    display_name:
      'Submit Datetime (fixed at first submission, preserved on restart)',
    valueExample: '2026-04-10 12:00:00',
    created_by: 'intrinsic',
  },
  {
    name: 'startDatetime',
    display_name: 'Start Datetime (updated on every restart)',
    valueExample: '2026-04-10 12:00:00',
    created_by: 'intrinsic',
  },
  {
    name: 'attemptCount',
    display_name: 'Attempt Count (incremented on every restart)',
    valueExample: '1',
    created_by: 'intrinsic',
  },
]

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
        blueprint_id: parent_id,
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

    return HttpResponse.json({ blueprint_id: newId, version: 1 })
  }),

  http.post(API_ENDPOINTS.fable.update, async ({ request }) => {
    await delay(400)

    let body: BlueprintUpdateRequest
    try {
      body = (await request.json()) as BlueprintUpdateRequest
    } catch {
      return HttpResponse.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    const existing = savedFablesState[body.blueprint_id]
    if (!existing) {
      return HttpResponse.json(
        { message: 'Blueprint not found' },
        { status: 404 },
      )
    }

    const currentVersion = fableVersions[body.blueprint_id] ?? 1
    if (body.version !== currentVersion) {
      return HttpResponse.json({ message: 'Version conflict' }, { status: 409 })
    }

    const newVersion = currentVersion + 1
    fableVersions[body.blueprint_id] = newVersion

    savedFablesState[body.blueprint_id] = {
      ...existing,
      fable: body.builder,
      display_name: body.display_name ?? existing.display_name,
      display_description:
        body.display_description ?? existing.display_description,
      tags: body.tags ?? existing.tags,
      updated_at: new Date().toISOString(),
    }

    return HttpResponse.json({
      blueprint_id: body.blueprint_id,
      version: newVersion,
    })
  }),

  http.get(API_ENDPOINTS.fable.list, async () => {
    await delay(200)

    const blueprints = Object.entries(savedFablesState)
      .filter(
        (pair): pair is [string, SavedFableEntry] => pair[1] !== undefined,
      )
      .map(([id, entry]) => ({
        blueprint_id: id,
        version: fableVersions[id] ?? 1,
        display_name: entry.display_name,
        display_description: entry.display_description,
        tags: entry.tags,
        source: null,
        created_by: entry.user_id,
      }))

    return HttpResponse.json({
      blueprints,
      total: blueprints.length,
      page: 1,
      page_size: 50,
    })
  }),

  http.get(API_ENDPOINTS.fable.glyphsFunctions, async () => {
    await delay(150)
    return HttpResponse.json({
      functions: [
        {
          name: 'add_days',
          description: 'Add N days to a datetime: ${dt | add_days(7)}',
          kind: 'filter',
        },
        {
          name: 'sub_days',
          description: 'Subtract N days from a datetime',
          kind: 'filter',
        },
        {
          name: 'add_hours',
          description: 'Add N hours to a datetime',
          kind: 'filter',
        },
        {
          name: 'floor_day',
          description: 'Truncate a datetime to the start of its day',
          kind: 'filter',
        },
        {
          name: 'floor_hour',
          description: 'Truncate a datetime to the start of its hour',
          kind: 'filter',
        },
        {
          name: 'split',
          description: 'Split a string by a separator: ${s | split(",")}',
          kind: 'filter',
        },
        {
          name: 'timedelta',
          description:
            'Construct a timedelta: ${dt + timedelta(days=1, hours=2)}',
          kind: 'global',
        },
        {
          name: 'datetime',
          description: 'Construct a datetime literal',
          kind: 'global',
        },
      ],
    })
  }),

  http.get(API_ENDPOINTS.fable.glyphsList, async ({ request }) => {
    await delay(200)
    const url = new URL(request.url)
    const glyphType = url.searchParams.get('glyph_type') ?? 'intrinsic'

    if (glyphType === 'intrinsic') {
      return HttpResponse.json({
        glyphs: mockIntrinsicGlyphs,
        total: mockIntrinsicGlyphs.length,
        page: 1,
        page_size: mockIntrinsicGlyphs.length,
      })
    }

    // global
    const page = Number(url.searchParams.get('page') ?? '1')
    const pageSize = Number(url.searchParams.get('page_size') ?? '50')
    const start = (page - 1) * pageSize
    const slice = mockGlobalGlyphs.slice(start, start + pageSize)
    return HttpResponse.json({
      glyphs: slice.map((g) => ({
        name: g.key,
        display_name: g.key,
        valueExample: g.value,
        created_by: g.created_by,
      })),
      total: mockGlobalGlyphs.length,
      page,
      page_size: pageSize,
    })
  }),

  http.post(API_ENDPOINTS.fable.glyphsGlobalPost, async ({ request }) => {
    await delay(300)
    const body = (await request.json()) as {
      key: string
      value: string
      public?: boolean
      overriddable?: boolean | null
    }
    const isPublic = body.public ?? false
    const overriddable = body.overriddable ?? null

    const intrinsicNames = new Set(mockIntrinsicGlyphs.map((g) => g.name))
    if (intrinsicNames.has(body.key)) {
      return HttpResponse.json(
        {
          detail: `Key '${body.key}' is reserved as an intrinsic glyph and cannot be overridden.`,
        },
        { status: 422 },
      )
    }
    if (isPublic && overriddable === null) {
      return HttpResponse.json(
        { detail: 'overriddable must be specified when public=True.' },
        { status: 422 },
      )
    }
    if (!isPublic && overriddable !== null) {
      return HttpResponse.json(
        { detail: 'overriddable must not be specified when public=False.' },
        { status: 422 },
      )
    }

    const existing = mockGlobalGlyphs.find((g) => g.key === body.key)
    const now = new Date().toISOString()
    if (existing) {
      existing.value = body.value
      existing.public = isPublic
      existing.overriddable = overriddable
      existing.updated_at = now
      return HttpResponse.json(existing)
    }

    const newGlyph: MockGlobalGlyph = {
      global_glyph_id: `glyph-${String(glyphIdCounter++).padStart(3, '0')}`,
      key: body.key,
      value: body.value,
      public: isPublic,
      overriddable,
      created_by: 'mock-user-123',
      created_at: now,
      updated_at: now,
    }
    mockGlobalGlyphs.push(newGlyph)
    return HttpResponse.json(newGlyph)
  }),

  http.get(API_ENDPOINTS.fable.glyphsGlobalGet, async ({ request }) => {
    await delay(200)
    const url = new URL(request.url)
    const id = url.searchParams.get('global_glyph_id')
    const glyph = mockGlobalGlyphs.find((g) => g.global_glyph_id === id)
    if (!glyph) {
      return HttpResponse.json(
        { detail: `GlobalGlyph '${id}' not found.` },
        { status: 404 },
      )
    }
    return HttpResponse.json(glyph)
  }),

  http.get(API_ENDPOINTS.fable.get, async ({ request }) => {
    await delay(300)

    const url = new URL(request.url)
    const fableId = url.searchParams.get('blueprint_id')

    if (!fableId) {
      return HttpResponse.json(
        { message: 'Missing blueprint_id parameter' },
        { status: 400 },
      )
    }

    const saved = savedFablesState[fableId]
    if (!saved) {
      return HttpResponse.json({ message: 'Fable not found' }, { status: 404 })
    }

    return HttpResponse.json({
      blueprint_id: fableId,
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
