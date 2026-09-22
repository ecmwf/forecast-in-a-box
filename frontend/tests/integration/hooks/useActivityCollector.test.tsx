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
 * The collector must respect a dismissal of a running job until the job
 * finishes, then show the outcome once.
 */

import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { getExecution, injectMockExecution } from '../../../mocks/data/job.data'
import { jobKeys } from '@/api/hooks/useJobs'
import { useActivityCollector } from '@/hooks/useActivityCollector'
import { useActivityStore } from '@/stores/activityStore'

const RUN_ID = 'job-submitted-004'
const TASK_ID = `job:${RUN_ID}`

function Collector() {
  useActivityCollector()
  return null
}

const state = () => useActivityStore.getState()

describe('useActivityCollector dismissals', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    useActivityStore.setState({ tasks: {}, dismissed: {} })
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    })
  })

  /** Force the recent-runs query to refetch, as the 10 s poll would. */
  const poll = async () => {
    await queryClient.invalidateQueries({ queryKey: jobKeys.all })
    await queryClient.refetchQueries({ queryKey: jobKeys.all })
  }

  it('keeps a dismissed running job hidden, then shows its outcome once', async () => {
    await renderWithProviders(<Collector />, { queryClient })
    await expect.poll(() => state().tasks[TASK_ID]?.status).toBe('active')

    state().clearAll()
    expect(state().tasks[TASK_ID]).toBeUndefined()
    expect(state().dismissed[TASK_ID]).toBe(true)

    // Still running: the next poll must not resurrect it.
    await poll()
    expect(state().tasks[TASK_ID]).toBeUndefined()

    // Finished: it comes back with the outcome and the dismissal is lifted.
    const run = getExecution(RUN_ID)!
    injectMockExecution({ ...run, status: 'completed' })
    await poll()
    await expect.poll(() => state().tasks[TASK_ID]?.status).toBe('completed')
    expect(state().dismissed[TASK_ID]).toBeUndefined()
  })

  it('forgets a dismissal once the run leaves the recent list', async () => {
    useActivityStore.setState({ dismissed: { 'job:long-gone': true } })
    await renderWithProviders(<Collector />, { queryClient })
    await expect.poll(() => state().dismissed['job:long-gone']).toBeUndefined()
  })
})
