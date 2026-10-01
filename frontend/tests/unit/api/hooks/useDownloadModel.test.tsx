/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** A finished download stays "downloading" until the list has refetched. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useDownloadModel } from '@/api/hooks/useArtifacts'

// Not downloaded in the mock catalogue; the mock reaches 100 % in a few polls.
const MODEL = {
  artifact_store_id: 'ecmwf',
  artifact_local_id: 'aifs-single-mse-1.1_w_sdpa',
}

describe('useDownloadModel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps the progress entry until the list invalidation settles', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let settle!: () => void
    const invalidation = new Promise<void>((resolve) => {
      settle = resolve
    })
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => invalidation)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useDownloadModel(), { wrapper })
    result.current.mutate(MODEL)
    await expect.poll(() => result.current.isDownloading(MODEL)).toBe(true)

    // The poll loop finished: invalidation requested, entry still held.
    await expect
      .poll(() => invalidate.mock.calls.length, { timeout: 20_000 })
      .toBeGreaterThan(0)
    expect(result.current.isDownloading(MODEL)).toBe(true)
    expect(result.current.getProgress(MODEL)).toBe(100)

    settle()
    await expect.poll(() => result.current.isDownloading(MODEL)).toBe(false)
  }, 30_000)
})
