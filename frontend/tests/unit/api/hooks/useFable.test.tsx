/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { worker } from '@tests/../mocks/browser'
import type { ReactNode } from 'react'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import {
  fableKeys,
  useBlockCatalogue,
  useBlockFactory,
  useCompileFable,
  useExpandFable,
  useFable,
  useFableValidation,
  useUpsertFable,
} from '@/api/hooks/useFable'
import { API_ENDPOINTS } from '@/api/endpoints'

// Mock the env module
vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

const mockCatalogue: BlockFactoryCatalogue = {
  'ecmwf/core-plugin': {
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

const mockFable: FableBuilderV1 = {
  blocks: {
    'block-1': {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'core-plugin' },
        factory: 'model',
      },
      configuration_values: { param1: 'value1' },
      input_ids: {},
    },
  },
}

const mockExpansion = {
  global_errors: [],
  block_errors: {},
  possible_sources: [],
  possible_expansions: {},
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function renderWithQueryClient(
  ui: ReactNode,
  queryClient: QueryClient = createTestQueryClient(),
) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe('fableKeys', () => {
  it('generates correct all key', () => {
    expect(fableKeys.all).toEqual(['fable'])
  })

  it('generates correct catalogue key', () => {
    expect(fableKeys.catalogue()).toEqual(['fable', 'catalogue'])
  })

  it('generates correct detail key', () => {
    expect(fableKeys.detail('test-id')).toEqual(['fable', 'detail', 'test-id'])
  })

  it('generates correct validation key', () => {
    const fable = { blocks: {} }
    expect(fableKeys.validation(fable)).toEqual([
      'fable',
      'validation',
      JSON.stringify(fable),
    ])
  })
})

describe('useBlockCatalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches catalogue successfully', async () => {
    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, () => {
        return HttpResponse.json(mockCatalogue)
      }),
    )

    let capturedData: ReturnType<typeof useBlockCatalogue> | null = null

    function TestComponent() {
      const result = useBlockCatalogue()
      capturedData = result
      return (
        <div data-testid="status">
          {result.isLoading ? 'loading' : 'loaded'}
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    expect(capturedData!.data).toBeDefined()
    expect(capturedData!.data!['ecmwf/core-plugin']).toBeDefined()
  })

  it('includes language parameter', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockCatalogue)
      }),
    )

    function TestComponent() {
      const result = useBlockCatalogue('de')
      return (
        <div data-testid="status">
          {result.isLoading ? 'loading' : 'loaded'}
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    expect(capturedUrl).toContain('language=de')
  })
})

describe('useFable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('fetches fable by ID', async () => {
    worker.use(
      http.get(API_ENDPOINTS.fable.retrieve, () => {
        return HttpResponse.json(mockFable)
      }),
    )

    let capturedData: ReturnType<typeof useFable> | null = null

    function TestComponent() {
      const result = useFable('test-fable-id')
      capturedData = result
      return (
        <div data-testid="status">
          {result.isLoading ? 'loading' : 'loaded'}
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    expect(capturedData!.data!.blocks).toBeDefined()
  })

  it('does not fetch when fableId is null', async () => {
    let fetchCalled = false

    worker.use(
      http.get(API_ENDPOINTS.fable.retrieve, () => {
        fetchCalled = true
        return HttpResponse.json(mockFable)
      }),
    )

    function TestComponent() {
      const result = useFable(null)
      return <div data-testid="enabled">{result.fetchStatus}</div>
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('enabled'))
      .toHaveTextContent('idle')
    expect(fetchCalled).toBe(false)
  })
})

describe('useExpandFable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('expands fable successfully', async () => {
    worker.use(
      http.put(API_ENDPOINTS.fable.expand, () => {
        return HttpResponse.json(mockExpansion)
      }),
    )

    let mutationResult: ReturnType<typeof useExpandFable> | null = null

    function TestComponent() {
      const result = useExpandFable()
      mutationResult = result
      return (
        <div>
          <button data-testid="expand" onClick={() => result.mutate(mockFable)}>
            Expand
          </button>
          <div data-testid="status">{result.status}</div>
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await screen.getByTestId('expand').click()

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('success')
    expect(mutationResult!.data!.global_errors).toEqual([])
  })
})

describe('useFableValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('validates fable when enabled', async () => {
    worker.use(
      http.put(API_ENDPOINTS.fable.expand, () => {
        return HttpResponse.json(mockExpansion)
      }),
    )

    let capturedData: ReturnType<typeof useFableValidation> | null = null

    function TestComponent() {
      const result = useFableValidation(mockFable, true)
      capturedData = result
      return (
        <div data-testid="status">
          {result.isLoading ? 'loading' : 'loaded'}
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    expect(capturedData!.data!.global_errors).toEqual([])
  })

  it('does not validate when fable is null', async () => {
    let fetchCalled = false

    worker.use(
      http.put(API_ENDPOINTS.fable.expand, () => {
        fetchCalled = true
        return HttpResponse.json(mockExpansion)
      }),
    )

    function TestComponent() {
      const result = useFableValidation(null, true)
      return <div data-testid="status">{result.fetchStatus}</div>
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect.element(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(fetchCalled).toBe(false)
  })

  it('does not validate when disabled', async () => {
    let fetchCalled = false

    worker.use(
      http.put(API_ENDPOINTS.fable.expand, () => {
        fetchCalled = true
        return HttpResponse.json(mockExpansion)
      }),
    )

    function TestComponent() {
      const result = useFableValidation(mockFable, false)
      return <div data-testid="status">{result.fetchStatus}</div>
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect.element(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(fetchCalled).toBe(false)
  })

  it('does not validate when fable has no blocks', async () => {
    let fetchCalled = false

    worker.use(
      http.put(API_ENDPOINTS.fable.expand, () => {
        fetchCalled = true
        return HttpResponse.json(mockExpansion)
      }),
    )

    const emptyFable: FableBuilderV1 = { blocks: {} }

    function TestComponent() {
      const result = useFableValidation(emptyFable, true)
      return <div data-testid="status">{result.fetchStatus}</div>
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect.element(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(fetchCalled).toBe(false)
  })
})

describe('useCompileFable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('compiles fable successfully', async () => {
    const mockCompiled = { compiled: true, output: 'some-output' }

    worker.use(
      http.put(API_ENDPOINTS.fable.compile, () => {
        return HttpResponse.json(mockCompiled)
      }),
    )

    let mutationResult: ReturnType<typeof useCompileFable> | null = null

    function TestComponent() {
      const result = useCompileFable()
      mutationResult = result
      return (
        <div>
          <button
            data-testid="compile"
            onClick={() => result.mutate(mockFable)}
          >
            Compile
          </button>
          <div data-testid="status">{result.status}</div>
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await screen.getByTestId('compile').click()

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('success')
    expect(mutationResult!.data).toEqual(mockCompiled)
  })
})

describe('useUpsertFable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('creates new fable', async () => {
    worker.use(
      http.post(API_ENDPOINTS.fable.upsert, () => {
        return HttpResponse.json('new-fable-id')
      }),
    )

    let mutationResult: ReturnType<typeof useUpsertFable> | null = null

    function TestComponent() {
      const result = useUpsertFable()
      mutationResult = result
      return (
        <div>
          <button
            data-testid="upsert"
            onClick={() => result.mutate({ fable: mockFable })}
          >
            Upsert
          </button>
          <div data-testid="status">{result.status}</div>
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await screen.getByTestId('upsert').click()

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('success')
    expect(mutationResult!.data).toBe('new-fable-id')
  })

  it('updates existing fable', async () => {
    let capturedUrl: string | null = null

    worker.use(
      http.post(API_ENDPOINTS.fable.upsert, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json('updated-fable-id')
      }),
    )

    function TestComponent() {
      const result = useUpsertFable()
      return (
        <div>
          <button
            data-testid="upsert"
            onClick={() =>
              result.mutate({ fable: mockFable, fableId: 'existing-id' })
            }
          >
            Upsert
          </button>
          <div data-testid="status">{result.status}</div>
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await screen.getByTestId('upsert').click()

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('success')
    expect(capturedUrl).toContain('fable_builder_id=existing-id')
  })
})

describe('useBlockFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('returns factory from catalogue', async () => {
    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, () => {
        return HttpResponse.json(mockCatalogue)
      }),
    )

    let capturedResult: ReturnType<typeof useBlockFactory> | null = null

    function TestComponent() {
      const result = useBlockFactory({
        plugin: { store: 'ecmwf', local: 'core-plugin' },
        factory: 'model',
      })
      capturedResult = result
      return (
        <div data-testid="status">
          {result.isLoading ? 'loading' : 'loaded'}
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    expect(capturedResult!.factory!.title).toBe('Model')
    expect(capturedResult!.notFound).toBe(false)
  })

  it('returns notFound when factory does not exist', async () => {
    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, () => {
        return HttpResponse.json(mockCatalogue)
      }),
    )

    let capturedResult: ReturnType<typeof useBlockFactory> | null = null

    function TestComponent() {
      const result = useBlockFactory({
        plugin: { store: 'ecmwf', local: 'nonexistent-plugin' },
        factory: 'model',
      })
      capturedResult = result
      return (
        <div data-testid="status">
          {result.isLoading ? 'loading' : 'loaded'}
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    expect(capturedResult!.factory).toBeUndefined()
    expect(capturedResult!.notFound).toBe(true)
  })

  it('returns undefined factory when factoryId is null', async () => {
    worker.use(
      http.get(API_ENDPOINTS.fable.catalogue, () => {
        return HttpResponse.json(mockCatalogue)
      }),
    )

    function TestComponent() {
      const result = useBlockFactory(null)
      return (
        <div>
          <div data-testid="status">
            {result.isLoading ? 'loading' : 'loaded'}
          </div>
          <div data-testid="factory">
            {result.factory ? 'has-factory' : 'no-factory'}
          </div>
          <div data-testid="notFound">
            {result.notFound ? 'not-found' : 'ok'}
          </div>
        </div>
      )
    }

    const screen = await renderWithQueryClient(<TestComponent />)

    await expect
      .element(screen.getByTestId('status'))
      .toHaveTextContent('loaded')
    await expect
      .element(screen.getByTestId('factory'))
      .toHaveTextContent('no-factory')
    await expect.element(screen.getByTestId('notFound')).toHaveTextContent('ok')
  })
})
