/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * StoredOutputsCard Integration Tests
 *
 * Exercises the disk-written-sink card against the MSW job + lens handlers:
 * - rows derive from GribSink marker outputs (one per sink block, deduped
 *   across that sink's tasks) with the directory resolved from the payload
 * - unavailable markers disable the lens actions
 * - the copy action: start lens on the resolved directory → poll until
 *   running → row shows the running badge with port → Stop tears it down
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { listMockLenses, resetLensState } from '@tests/../mocks/data/lens.data'
import { resetJobsState } from '@tests/../mocks/data/job.data'
import type { RunOutputs } from '@/api/types/job.types'
import { StoredOutputsCard } from '@/features/executions/components/StoredOutputsCard'
import i18n from '@/lib/i18n'

// Matches the job-completed-001 seed: its `task-out-grib` marker output's
// payload resolves to /data/output/job-completed-001_1 (mockBlobForMime).
const GRIB_DIR_MIME = 'text/plain; fiab-format=gribdir'

const outputsWithMarkers: RunOutputs = {
  'task-out-1': {
    mime_type: 'image/png',
    original_block: 'sink_temperature_map',
    is_available: true,
  },
  // Two marker tasks of the same sink block — must collapse into one row.
  'task-out-grib': {
    mime_type: GRIB_DIR_MIME,
    original_block: 'block_sink_1',
    is_available: true,
  },
  'task-out-grib-2': {
    mime_type: GRIB_DIR_MIME,
    original_block: 'block_sink_1',
    is_available: true,
  },
}

async function renderCard(outputs: RunOutputs | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <StoredOutputsCard jobId="job-completed-001" outputs={outputs} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetJobsState()
  resetLensState()
})

describe('StoredOutputsCard', () => {
  it('renders one row per sink block and resolves the directory from the payload', async () => {
    const screen = await renderCard(outputsWithMarkers)
    await expect.element(screen.getByText('job-completed-001_1')).toBeVisible()
    // Two marker tasks, one sink block — exactly one row.
    expect(screen.getByText('block_sink_1').elements()).toHaveLength(1)
    // Non-marker outputs are not listed.
    expect(screen.getByText('sink_temperature_map').elements()).toHaveLength(0)
  })

  it('renders nothing without marker outputs', async () => {
    const screen = await renderCard({
      'task-out-1': {
        mime_type: 'image/png',
        original_block: 'sink_temperature_map',
        is_available: true,
      },
    })
    expect(screen.getByText('Stored outputs').elements()).toHaveLength(0)
  })

  it('disables lens actions while the marker output is unavailable', async () => {
    const screen = await renderCard({
      'task-out-grib': {
        mime_type: GRIB_DIR_MIME,
        original_block: 'block_sink_1',
        is_available: false,
      },
    })
    await expect
      .element(screen.getByText('File not yet written by the run'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: /^open/i }))
      .toBeDisabled()
  })

  it('disables lens actions when SkinnyWMS is not installed on the server', async () => {
    resetLensState({ skinnyWmsInstalled: false })
    const screen = await renderCard(outputsWithMarkers)
    // Rows still render (the path is useful information on its own) …
    await expect.element(screen.getByText('job-completed-001_1')).toBeVisible()
    // … but the lens actions are disabled with an explanatory title.
    const openButton = screen.getByRole('button', { name: /^open/i })
    await expect.element(openButton).toBeDisabled()
    await expect
      .element(openButton)
      .toHaveAttribute('title', expect.stringContaining('not available'))
  })

  it('copy starts the lens on the directory, the row shows a running badge, Stop tears it down', async () => {
    const screen = await renderCard(outputsWithMarkers)
    // Wait for the payload-resolved directory (enables the actions).
    await expect.element(screen.getByText('job-completed-001_1')).toBeVisible()

    await screen.getByRole('button', { name: /copy wms url/i }).click()

    await expect.element(screen.getByText(/WMS running :54300/)).toBeVisible()
    expect(listMockLenses()).toHaveLength(1)
    expect(listMockLenses()[0].status).toBe('running')
    // The lens serves the run-private directory from the payload.
    expect(listMockLenses()[0].lens_params.local_path).toBe(
      '/data/output/job-completed-001_1',
    )

    await screen.getByRole('button', { name: /^stop$/i }).click()
    await expect
      .element(screen.getByText(/WMS running/))
      .not.toBeInTheDocument()
    // The stop request settles asynchronously after the badge clears.
    await expect.poll(() => listMockLenses()).toHaveLength(0)
  })
})
