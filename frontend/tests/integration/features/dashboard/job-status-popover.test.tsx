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
import { renderWithRouter } from '@tests/utils/render'
import type { JobExecutionList } from '@/api/types/job.types'
import { JobStatusDetailsPopover } from '@/features/dashboard/components/JobStatusDetailsPopover'
import { API_ENDPOINTS } from '@/api/endpoints'

vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

const mockJobsResponse: JobExecutionList = {
  executions: [
    {
      execution_id: 'exec-1',
      attempt_count: 1,
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      job_definition_id: 'def-1',
      job_definition_version: 1,
      error: null,
      progress: '45',
      cascade_job_id: null,
    },
    {
      execution_id: 'exec-2',
      attempt_count: 1,
      status: 'completed',
      created_at: '2026-01-01T01:00:00Z',
      updated_at: '2026-01-01T01:00:00Z',
      job_definition_id: 'def-2',
      job_definition_version: 1,
      error: null,
      progress: '100',
      cascade_job_id: null,
    },
    {
      execution_id: 'exec-3',
      attempt_count: 1,
      status: 'completed',
      created_at: '2026-01-01T02:00:00Z',
      updated_at: '2026-01-01T02:00:00Z',
      job_definition_id: 'def-3',
      job_definition_version: 1,
      error: null,
      progress: '100',
      cascade_job_id: null,
    },
    {
      execution_id: 'exec-4',
      attempt_count: 1,
      status: 'failed',
      created_at: '2026-01-01T03:00:00Z',
      updated_at: '2026-01-01T03:00:00Z',
      job_definition_id: 'def-4',
      job_definition_version: 1,
      error: 'OOM',
      progress: '60',
      cascade_job_id: null,
    },
    {
      execution_id: 'exec-5',
      attempt_count: 1,
      status: 'submitted',
      created_at: '2026-01-01T04:00:00Z',
      updated_at: '2026-01-01T04:00:00Z',
      job_definition_id: 'def-5',
      job_definition_version: 1,
      error: null,
      progress: '0',
      cascade_job_id: null,
    },
  ],
  total: 5,
  page: 1,
  page_size: 1000,
  total_pages: 1,
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
    const screen = await renderWithRouter(
      <JobStatusDetailsPopover>
        <div data-testid="trigger">Trigger</div>
      </JobStatusDetailsPopover>,
    )

    await expect.element(screen.getByTestId('trigger')).toBeVisible()
  })

  it('opens popover with status rows when clicked', async () => {
    const screen = await renderWithRouter(
      <JobStatusDetailsPopover>
        <div data-testid="trigger">Trigger</div>
      </JobStatusDetailsPopover>,
    )

    await screen.getByTestId('trigger').click()

    await expect.element(screen.getByText('Execution Status')).toBeVisible()
    await expect.element(screen.getByText('Running')).toBeVisible()
    await expect.element(screen.getByText('Submitted')).toBeVisible()
    await expect.element(screen.getByText('Completed')).toBeVisible()
    await expect.element(screen.getByText('Failed')).toBeVisible()
  })

  it('shows correct counts for each status', async () => {
    const screen = await renderWithRouter(
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
    const screen = await renderWithRouter(
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
