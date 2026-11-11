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
import { renderHook } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { strToU8, zipSync } from 'fflate'
import { worker } from '@tests/test-extend'
import { API_ENDPOINTS } from '@/api/endpoints'
import { useLogSnapshot } from '@/features/executions/hooks/useLogSnapshot'

describe('useLogSnapshot', () => {
  it('cancels the download and starts no worker once unmounted', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    worker.use(
      http.get(API_ENDPOINTS.job.logs, async () => {
        await held
        const zip = zipSync({ 'job_a.controller.logs.txt': strToU8('start') })
        return HttpResponse.arrayBuffer(zip.slice().buffer, {
          headers: { 'Content-Type': 'application/zip' },
        })
      }),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const RealWorker = Worker
    let created = 0
    function CountedWorker(url: URL, options?: WorkerOptions) {
      created++
      return new RealWorker(url, options)
    }
    vi.stubGlobal('Worker', CountedWorker)
    try {
      const { result, unmount } = renderHook(() =>
        useLogSnapshot('job-completed-001'),
      )
      const loading = result.current.load()
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())

      unmount()
      expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true)
      release()
      await expect(loading).resolves.toBeNull()
      expect(created).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      fetchSpy.mockRestore()
    }
  })
})
