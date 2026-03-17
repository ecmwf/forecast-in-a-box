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
  compileFableV2,
  expandFable,
  getCatalogue,
  retrieveFableV2,
  upsertFableV2,
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

describe('retrieveFableV2', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('retrieves fable by ID with full metadata', async () => {
    const mockResponse = {
      id: 'fable-123',
      version: 1,
      builder: mockFable,
      display_name: 'My Config',
      display_description: 'Some description',
      tags: ['tag1'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }

    worker.use(
      http.get(API_ENDPOINTS.fable.retrieveV2, () => {
        return HttpResponse.json(mockResponse)
      }),
    )

    const result = await retrieveFableV2('fable-123')
    expect(result.id).toBe('fable-123')
    expect(result.version).toBe(1)
    expect(result.builder.blocks).toBeDefined()
    expect(result.display_name).toBe('My Config')
  })

  it('sends fable_builder_id as query parameter', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.get(API_ENDPOINTS.fable.retrieveV2, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({
          id: 'fable-456',
          version: 1,
          builder: mockFable,
          display_name: 'Test',
          display_description: '',
          tags: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      }),
    )

    await retrieveFableV2('fable-456')
    expect(capturedUrl).toContain('fable_builder_id=fable-456')
  })
})

describe('upsertFableV2', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('creates new fable and returns { id, version }', async () => {
    let capturedBody: unknown = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsertV2, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 'new-fable-id', version: 1 })
      }),
    )

    const result = await upsertFableV2({
      builder: mockFable,
      display_name: 'My Config',
      display_description: 'Some notes',
      tags: [],
    })
    expect(result.id).toBe('new-fable-id')
    expect(result.version).toBe(1)
    expect(capturedBody).toMatchObject({
      builder: mockFable,
      display_name: 'My Config',
      display_description: 'Some notes',
    })
  })

  it('passes parent_id in body for update', async () => {
    let capturedBody: unknown = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsertV2, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 'existing-id', version: 2 })
      }),
    )

    await upsertFableV2({
      builder: mockFable,
      display_name: 'Updated Config',
      display_description: '',
      tags: [],
      parent_id: 'existing-id',
    })
    expect(capturedBody).toMatchObject({ parent_id: 'existing-id' })
  })
})

describe('compileFableV2', () => {
  afterEach(() => {
    worker.resetHandlers()
  })

  it('compiles fable by reference and returns execution spec', async () => {
    const mockCompiled = {
      job: {
        job_type: 'raw_cascade_job',
        job_instance: { tasks: {}, edges: [] },
      },
      environment: {
        hosts: null,
        workers_per_host: null,
        environment_variables: {},
      },
      shared: false,
    }

    let capturedBody: unknown = null

    worker.use(
      http.put(API_ENDPOINTS.fable.compileV2, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(mockCompiled)
      }),
    )

    const result = await compileFableV2({ id: 'fable-123' })
    expect(result).toEqual(mockCompiled)
    expect(capturedBody).toEqual({ id: 'fable-123' })
  })

  it('sends optional version when provided', async () => {
    let capturedBody: unknown = null

    worker.use(
      http.put(API_ENDPOINTS.fable.compileV2, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          job: {
            job_type: 'raw_cascade_job',
            job_instance: { tasks: {}, edges: [] },
          },
          environment: {
            hosts: null,
            workers_per_host: null,
            environment_variables: {},
          },
          shared: false,
        })
      }),
    )

    await compileFableV2({ id: 'fable-123', version: 2 })
    expect(capturedBody).toEqual({ id: 'fable-123', version: 2 })
  })
})
