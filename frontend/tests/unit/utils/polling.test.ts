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
import { createPollingTask, wait } from '@/utils/polling'

describe('wait', () => {
  it('resolves after the given delay', async () => {
    const start = Date.now()
    await wait(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })

  it('rejects with AbortError if the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(wait(100, controller.signal)).rejects.toThrow(/aborted/i)
  })

  it('rejects with AbortError if the signal aborts during the wait', async () => {
    const controller = new AbortController()
    const p = wait(1_000, controller.signal)
    controller.abort()
    await expect(p).rejects.toThrow(/aborted/i)
  })
})

describe('createPollingTask', () => {
  it('polls until `until` returns true and resolves with that value', async () => {
    let n = 0
    const controller = new AbortController()

    const result = await createPollingTask<number>({
      poll: () => Promise.resolve(++n),
      until: (v) => v >= 3,
      interval: 0,
      signal: controller.signal,
    })

    expect(result).toBe(3)
    expect(n).toBe(3)
  })

  it('invokes onProgress for every polled value, including the terminal one', async () => {
    const onProgress = vi.fn()
    let n = 0
    const controller = new AbortController()

    await createPollingTask<number>({
      poll: () => Promise.resolve(++n),
      until: (v) => v >= 3,
      interval: 0,
      signal: controller.signal,
      onProgress,
    })

    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([1, 2, 3])
  })

  it('rejects with AbortError if the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const poll = vi.fn(() => Promise.resolve(1))

    await expect(
      createPollingTask({
        poll,
        until: () => true,
        interval: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i)
    expect(poll).not.toHaveBeenCalled()
  })

  it('rejects with AbortError if the signal aborts between polls', async () => {
    let n = 0
    const controller = new AbortController()

    const p = createPollingTask<number>({
      poll: () => {
        const v = ++n
        if (v === 2) controller.abort()
        return Promise.resolve(v)
      },
      until: (v) => v >= 10,
      interval: 50,
      signal: controller.signal,
    })

    await expect(p).rejects.toThrow(/aborted/i)
    expect(n).toBe(2)
  })

  it('propagates errors thrown by `poll`', async () => {
    const controller = new AbortController()
    await expect(
      createPollingTask({
        poll: () => Promise.reject(new Error('boom')),
        until: () => true,
        interval: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow('boom')
  })
})
