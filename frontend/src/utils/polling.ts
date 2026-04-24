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
 * Abortable polling primitives.
 *
 * `createPollingTask` drives a poll-until-condition loop with cancellation
 * via AbortSignal. `wait` is the underlying cancellable delay.
 */

/**
 * Resolve after `ms` milliseconds, or reject with AbortError if `signal`
 * fires first.
 */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

export interface CreatePollingTaskOptions<T> {
  /** Called once per iteration; its resolved value is checked against `until`. */
  poll: () => Promise<T>
  /** Terminal condition — when it returns true, the task resolves with that value. */
  until: (result: T) => boolean
  /** Delay between the previous `poll` resolving and the next one starting (ms). */
  interval: number
  /** Cancels the task; pending waits and subsequent polls reject with AbortError. */
  signal: AbortSignal
  /** Invoked with every polled value, including the terminal one. */
  onProgress?: (result: T) => void
}

/**
 * Repeatedly run `poll` with `interval` ms between attempts until `until`
 * returns true, then resolve with that terminal value.
 *
 * Errors from `poll` propagate out. Aborting the signal rejects with
 * AbortError — the caller owns teardown in a `finally`.
 */
export async function createPollingTask<T>({
  poll,
  until,
  interval,
  signal,
  onProgress,
}: CreatePollingTaskOptions<T>): Promise<T> {
  for (;;) {
    signal.throwIfAborted()
    const result = await poll()
    onProgress?.(result)
    if (until(result)) return result
    await wait(interval, signal)
  }
}
