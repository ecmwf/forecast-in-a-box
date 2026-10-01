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
import { beforeEach, describe, expect, it } from 'vitest'
import { worker } from '@tests/test-extend'
import { renderWithProviders } from '@tests/utils/render'
import { API_ENDPOINTS } from '@/api/endpoints'
import { RunAttemptTimeline } from '@/features/executions/components/RunAttemptTimeline'

const requested: Array<number> = []

// Attempt n started 10 min after n-1 and ran 90 s; every third one failed.
function serveAttempts() {
  worker.use(
    http.get(API_ENDPOINTS.job.get, ({ request }) => {
      const n = Number(new URL(request.url).searchParams.get('attempt_count'))
      requested.push(n)
      const start = Date.UTC(2026, 8, 25, 8, 0) + n * 600_000
      return HttpResponse.json({
        run_id: 'run-1',
        attempt_count: n,
        status: n % 3 === 0 ? 'failed' : 'completed',
        created_at: new Date(start).toISOString(),
        updated_at: new Date(start + 90_000).toISOString(),
        blueprint_id: 'bp',
        blueprint_version: 1,
        error: null,
        progress: '100',
        cascade_job_id: null,
        lost_task_ids: {},
        outputs: null,
      })
    }),
  )
}

describe('RunAttemptTimeline', () => {
  beforeEach(() => {
    requested.length = 0
    serveAttempts()
  })

  it('renders nothing for a single attempt', async () => {
    const screen = await renderWithProviders(
      <RunAttemptTimeline jobId="run-1" attemptCount={1} />,
    )
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.container.textContent).toBe('')
    expect(requested).toEqual([])
  })

  it('shows the count and failures on one line for a few attempts', async () => {
    const screen = await renderWithProviders(
      <RunAttemptTimeline jobId="run-1" attemptCount={3} />,
    )
    await expect
      .element(screen.getByRole('button', { name: /3 attempts\s*· 1 failed/ }))
      .toBeVisible()
  })

  it('fetches only the latest five until the history is opened', async () => {
    const screen = await renderWithProviders(
      <RunAttemptTimeline jobId="run-1" attemptCount={12} />,
    )
    const trigger = screen.getByRole('button', { name: /12 attempts/ })
    await expect.element(trigger).toBeVisible()
    await expect.element(screen.getByText('+7')).toBeInTheDocument()
    expect([...new Set(requested)].sort((a, b) => a - b)).toEqual([
      8, 9, 10, 11, 12,
    ])

    await trigger.click()
    await expect.element(screen.getByText('Attempt 1')).toBeInTheDocument()
    const entries = screen
      .getByRole('listitem')
      .all()
      .map((li) => li.element().textContent)
    expect(entries[0]).toMatch(/^Attempt 12 · Failed.*1 m 30 s$/)
    await expect
      .element(screen.getByRole('button', { name: /12 attempts\s*· 4 failed/ }))
      .toBeVisible()
  })
})
