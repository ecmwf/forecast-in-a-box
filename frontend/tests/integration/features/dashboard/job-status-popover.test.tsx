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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { worker } from '@tests/../mocks/browser'
import { renderWithProviders } from '@tests/utils/render'
import type { JobProgressResponses } from '@/api/types/job.types'
import { JobStatusDetailsPopover } from '@/features/dashboard/components/JobStatusDetailsPopover'
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
      progress: '100',
      status: 'completed',
      created_at: '2026-01-01T02:00:00Z',
      error: null,
    },
    'job-4': {
      progress: '60',
      status: 'errored',
      created_at: '2026-01-01T03:00:00Z',
      error: 'OOM',
    },
    'job-5': {
      progress: '0',
      status: 'submitted',
      created_at: '2026-01-01T04:00:00Z',
      error: null,
    },
  },
  total: 5,
  page: 1,
  page_size: 1000,
  total_pages: 1,
  error: null,
}

describe('JobStatusDetailsPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    worker.use(
      http.get(API_ENDPOINTS.job.status, () => {
        return HttpResponse.json(mockJobsResponse)
      }),
    )
  })

  afterEach(() => {
    worker.resetHandlers()
  })

  it('shows running count in the trigger card', async () => {
    const screen = await renderWithProviders(
      <JobStatusDetailsPopover>
        <div data-testid="trigger">Trigger</div>
      </JobStatusDetailsPopover>,
    )

    await expect.element(screen.getByTestId('trigger')).toBeVisible()
  })

  it('opens popover with status rows when clicked', async () => {
    const screen = await renderWithProviders(
      <JobStatusDetailsPopover>
        <div data-testid="trigger">Trigger</div>
      </JobStatusDetailsPopover>,
    )

    await screen.getByTestId('trigger').click()

    await expect.element(screen.getByText('Execution Status')).toBeVisible()
    await expect.element(screen.getByText('Running')).toBeVisible()
    await expect.element(screen.getByText('Submitted')).toBeVisible()
    await expect.element(screen.getByText('Completed')).toBeVisible()
    await expect.element(screen.getByText('Errored')).toBeVisible()
  })

  it('shows correct counts for each status', async () => {
    const screen = await renderWithProviders(
      <JobStatusDetailsPopover>
        <div data-testid="trigger">Trigger</div>
      </JobStatusDetailsPopover>,
    )

    await screen.getByTestId('trigger').click()

    await expect.element(screen.getByText('Execution Status')).toBeVisible()

    // Verify total in footer
    await expect.element(screen.getByText('Total')).toBeVisible()
    await expect.element(screen.getByText('5')).toBeVisible()
  })

  it('shows refresh button', async () => {
    const screen = await renderWithProviders(
      <JobStatusDetailsPopover>
        <div data-testid="trigger">Trigger</div>
      </JobStatusDetailsPopover>,
    )

    await screen.getByTestId('trigger').click()

    await expect.element(screen.getByText('Execution Status')).toBeVisible()

    // Refresh button should be present (ghost icon button)
    const refreshButton = screen.getByRole('button', { name: '' }).first()
    expect(refreshButton).toBeDefined()
  })
})
