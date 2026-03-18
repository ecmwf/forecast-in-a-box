/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useQueryClient } from '@tanstack/react-query'
import { QueryProvider } from '@/providers/QueryProvider'

// Mock the queryClient
vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    getDefaultOptions: () => ({}),
    setDefaultOptions: vi.fn(),
    getQueryDefaults: () => ({}),
    setQueryDefaults: vi.fn(),
    getMutationDefaults: () => ({}),
    setMutationDefaults: vi.fn(),
    getQueryCache: () => ({
      find: vi.fn(),
      findAll: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      clear: vi.fn(),
    }),
    getMutationCache: () => ({
      find: vi.fn(),
      findAll: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      clear: vi.fn(),
    }),
    mount: vi.fn(),
    unmount: vi.fn(),
  },
}))

// Test component that uses query client
function QueryClientConsumer() {
  const queryClient = useQueryClient()
  // useQueryClient always returns a client when inside QueryClientProvider
  return (
    <div data-testid="has-client" data-client-exists={String(!!queryClient)}>
      Has Client
    </div>
  )
}

describe('QueryProvider', () => {
  it('renders children', async () => {
    const screen = await render(
      <QueryProvider>
        <div data-testid="child">Child Content</div>
      </QueryProvider>,
    )

    await expect
      .element(screen.getByTestId('child'))
      .toHaveTextContent('Child Content')
  })

  it('provides query client to children', async () => {
    const screen = await render(
      <QueryProvider>
        <QueryClientConsumer />
      </QueryProvider>,
    )

    await expect
      .element(screen.getByTestId('has-client'))
      .toHaveTextContent('Has Client')
  })

  it('renders multiple children', async () => {
    const screen = await render(
      <QueryProvider>
        <div data-testid="first">First</div>
        <div data-testid="second">Second</div>
      </QueryProvider>,
    )

    await expect.element(screen.getByTestId('first')).toBeInTheDocument()
    await expect.element(screen.getByTestId('second')).toBeInTheDocument()
  })
})
