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
import type { JobProgressResponses } from '@/api/types/job.types'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { API_ENDPOINTS } from '@/api/endpoints'

vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

const mockJobsResponse: JobProgressResponses = {
  progresses: {
    'job-1': {
      progress: '45',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      error: null,
    },
    'job-2': {
      progress: '100',
      status: 'completed',
      created_at: '2026-01-01T01:00:00Z',
      error: null,
    },
    'job-3': {
      progress: '60',
      status: 'errored',
      created_at: '2026-01-01T02:00:00Z',
      error: 'OOM',
    },
    'job-4': {
      progress: '0',
      status: 'submitted',
      created_at: '2026-01-01T03:00:00Z',
      error: null,
    },
  },
  total: 4,
  page: 1,
  page_size: 1000,
  total_pages: 1,
  error: null,
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
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

describe('useJobStatusCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('computes counts correctly from API response', async () => {
    worker.use(
      http.get(API_ENDPOINTS.job.status, () => {
        return HttpResponse.json(mockJobsResponse)
      }),
    )

    let capturedData: ReturnType<typeof useJobStatusCounts> | null = null

    function TestComponent() {
      const result = useJobStatusCounts()
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

    expect(capturedData!.counts.running).toBe(1)
    expect(capturedData!.counts.completed).toBe(1)
    expect(capturedData!.counts.errored).toBe(1)
    expect(capturedData!.counts.submitted).toBe(1)
    expect(capturedData!.counts.invalid).toBe(0)
    expect(capturedData!.counts.timeout).toBe(0)
    expect(capturedData!.counts.unknown).toBe(0)
  })

  it('returns correct runningCount', async () => {
    worker.use(
      http.get(API_ENDPOINTS.job.status, () => {
        return HttpResponse.json(mockJobsResponse)
      }),
    )

    let capturedData: ReturnType<typeof useJobStatusCounts> | null = null

    function TestComponent() {
      const result = useJobStatusCounts()
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

    expect(capturedData!.runningCount).toBe(1)
    expect(capturedData!.total).toBe(4)
  })

  it('returns zero counts while loading', async () => {
    worker.use(
      http.get(API_ENDPOINTS.job.status, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return HttpResponse.json(mockJobsResponse)
      }),
    )

    let capturedData: ReturnType<typeof useJobStatusCounts> | null = null

    function TestComponent() {
      const result = useJobStatusCounts()
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
      .toHaveTextContent('loading')

    expect(capturedData!.isLoading).toBe(true)
    expect(capturedData!.runningCount).toBe(0)
    expect(capturedData!.total).toBe(0)
  })
})
