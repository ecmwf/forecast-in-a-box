/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Poll cadences, injectable so tests can shrink real poll/retry cycles. */

export interface PollIntervals {
  /** useLensList refetch cadence. */
  lensList: number
  /** useLensStatus cadence while `starting`. */
  lensStarting: number
  /** useLensStatus liveness cadence while `running`. */
  lensRunning: number
  /** Base of the exponential lens-status retry backoff. */
  lensRetryBase: number
  /** Catalogue-recovery poll while the backend reloads plugins. */
  pluginCatalogue: number
}

const PRODUCTION_INTERVALS: PollIntervals = {
  lensList: 5000,
  lensStarting: 1000,
  lensRunning: 15_000,
  lensRetryBase: 1000,
  pluginCatalogue: 2000,
}

export const pollIntervals: PollIntervals = { ...PRODUCTION_INTERVALS }

export function setPollIntervalsForTests(
  overrides: Partial<PollIntervals>,
): void {
  Object.assign(pollIntervals, overrides)
}

export function resetPollIntervals(): void {
  Object.assign(pollIntervals, PRODUCTION_INTERVALS)
}
