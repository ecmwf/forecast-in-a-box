/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Frame-driven tweens and their easing. */

export const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2

/** rAF tween of `step(0->1)`, even where rAF is throttled; false when aborted before the end. */
export function tween(
  durationMs: number,
  step: (p: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  if (durationMs <= 0) {
    step(1)
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    // The clock starts on the first drawn frame, not on the call.
    let start = -1
    let done = false
    const finish = (completed: boolean) => {
      if (done) return
      done = true
      if (completed) step(1)
      resolve(completed)
    }
    const frame = (now: number) => {
      if (done) return
      if (start < 0) start = now
      const p = Math.min(1, (now - start) / durationMs)
      if (p >= 1) return finish(true)
      step(p)
      requestAnimationFrame(frame)
    }
    signal?.addEventListener('abort', () => finish(false), { once: true })
    requestAnimationFrame(frame)
    window.setTimeout(() => finish(true), durationMs + 1500)
  })
}
