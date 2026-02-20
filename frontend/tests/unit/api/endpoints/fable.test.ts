/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/../mocks/browser'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import {
  compileFable,
  expandFable,
  getCatalogue,
  retrieveFable,
  upsertFable,
} from '@/api/endpoints/fable'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock the env module
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

const mockFable: FableBuilderV1 = {
  blocks: {
    'block-1': {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'core' },
        factory: 'model',
      },
      configuration_values: { param1: 'value1' },
      input_ids: {},
    },
  },
}

describe('getCatalogue', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches catalogue successfully', async () => {
    // BlockFactoryCatalogue is Record<string, PluginCatalogue>
    // PluginCatalogue has factories: Record<string, BlockFactory>
    const mockCatalogue = {
      'core-plugin': {
        factories: {
          model: {
            kind: 'source',
            title: 'Model',
            description: 'A model block',
            configuration_options: {},
            inputs: [],
          },
        },
      },
    }

    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, () => {
        return HttpResponse.json(mockCatalogue)
      }),
    )

    const result = await getCatalogue()
    expect(result['core-plugin']).toBeDefined()
    expect(result['core-plugin'].factories.model).toBeDefined()
  })

  it('includes language parameter when provided', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({})
      }),
    )

    await getCatalogue('de')
    expect(capturedUrl).toContain('language=de')
  })

  it('does not include language parameter when not provided', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({})
      }),
    )

    await getCatalogue()
    expect(capturedUrl).not.toContain('language=')
  })
})

describe('expandFable', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('expands fable configuration', async () => {
    // FableValidationExpansionSchema
    const mockExpansion = {
      global_errors: [],
      block_errors: {},
      possible_sources: [],
      possible_expansions: {},
    }

    worker.use(
      http.put(API_ENDPOINTS.fable.expand, () => {
        return HttpResponse.json(mockExpansion)
      }),
    )

    const result = await expandFable(mockFable)
    expect(result.global_errors).toEqual([])
    expect(result.block_errors).toEqual({})
  })

  it('sends fable as JSON body', async () => {
    let capturedBody: unknown = null

    worker.use(
      http.put(API_ENDPOINTS.fable.expand, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          global_errors: [],
          block_errors: {},
          possible_sources: [],
          possible_expansions: {},
        })
      }),
    )

    await expandFable(mockFable)
    expect(capturedBody).toEqual(mockFable)
  })
})

describe('compileFable', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('compiles fable configuration', async () => {
    const mockCompiled = { compiled: true, output: 'some-output' }

    worker.use(
      http.put(API_ENDPOINTS.fable.compile, () => {
        return HttpResponse.json(mockCompiled)
      }),
    )

    const result = await compileFable(mockFable)
    expect(result).toEqual(mockCompiled)
  })
})

describe('retrieveFable', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('retrieves fable by ID', async () => {
    worker.use(
      http.get(API_ENDPOINTS.fable.retrieve, () => {
        return HttpResponse.json(mockFable)
      }),
    )

    const result = await retrieveFable('fable-123')
    expect(result.blocks).toBeDefined()
    expect(Object.keys(result.blocks)).toHaveLength(1)
  })

  it('sends fable_builder_id as query parameter', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.get(API_ENDPOINTS.fable.retrieve, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockFable)
      }),
    )

    await retrieveFable('fable-456')
    expect(capturedUrl).toContain('fable_builder_id=fable-456')
  })
})

describe('upsertFable', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('creates new fable without ID', async () => {
    let capturedBody: unknown = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsert, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json('new-fable-id')
      }),
    )

    const result = await upsertFable(mockFable)
    expect(result).toBe('new-fable-id')
    expect(capturedBody).toEqual({ builder: mockFable })
  })

  it('updates existing fable with ID', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsert, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json('updated-fable-id')
      }),
    )

    await upsertFable(mockFable, 'existing-id')
    expect(capturedUrl).toContain('fable_builder_id=existing-id')
  })

  it('includes tags when provided', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsert, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json('tagged-fable-id')
      }),
    )

    await upsertFable(mockFable, undefined, ['tag1', 'tag2'])
    expect(capturedUrl).toContain('tags=tag1%2Ctag2')
  })

  it('does not include tags when empty array', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsert, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json('fable-id')
      }),
    )

    await upsertFable(mockFable, undefined, [])
    expect(capturedUrl).not.toContain('tags=')
  })
})
