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
import type { JobExecutionList } from '@/api/types/job.types'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { API_ENDPOINTS } from '@/api/endpoints'

vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

const mockJobsResponse: JobExecutionList = {
  runs: [
    {
      run_id: 'exec-1',
      attempt_count: 1,
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      blueprint_id: 'def-1',
      blueprint_version: 1,
      error: null,
      progress: '45',
      cascade_job_id: null,
      outputs: null,
    },
    {
      run_id: 'exec-2',
      attempt_count: 1,
      status: 'completed',
      created_at: '2026-01-01T01:00:00Z',
      updated_at: '2026-01-01T01:00:00Z',
      blueprint_id: 'def-2',
      blueprint_version: 1,
      error: null,
      progress: '100',
      cascade_job_id: null,
      outputs: null,
    },
    {
      run_id: 'exec-3',
      attempt_count: 1,
      status: 'failed',
      created_at: '2026-01-01T02:00:00Z',
      updated_at: '2026-01-01T02:00:00Z',
      blueprint_id: 'def-3',
      blueprint_version: 1,
      error: 'OOM',
      progress: '60',
      cascade_job_id: null,
      outputs: null,
    },
    {
      run_id: 'exec-4',
      attempt_count: 1,
      status: 'submitted',
      created_at: '2026-01-01T03:00:00Z',
      updated_at: '2026-01-01T03:00:00Z',
      blueprint_id: 'def-4',
      blueprint_version: 1,
      error: null,
      progress: '0',
      cascade_job_id: null,
      outputs: null,
    },
  ],
  total: 4,
  page: 1,
  page_size: 1000,
  total_pages: 1,
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
      http.get(API_ENDPOINTS.job.list, () => {
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
    expect(capturedData!.counts.failed).toBe(1)
    expect(capturedData!.counts.submitted).toBe(1)
    expect(capturedData!.counts.preparing).toBe(0)
  })

  it('returns correct runningCount', async () => {
    worker.use(
      http.get(API_ENDPOINTS.job.list, () => {
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
      http.get(API_ENDPOINTS.job.list, async () => {
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
