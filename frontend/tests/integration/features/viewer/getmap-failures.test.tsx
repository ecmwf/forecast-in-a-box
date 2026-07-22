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
 * GetMap failure cache: marks appear on failure, clear on success /
 * clearSlot / TTL — the three freshness guarantees that keep the track
 * marks from ever going stale.
 */

import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import type { GetMapFailureLog } from '@/features/viewer/geo/getmap-failures'
import { useGetMapFailureLog } from '@/features/viewer/geo/getmap-failures'

const T06 = '2026-07-06T06:00:00Z'
const T12 = '2026-07-06T12:00:00Z'
const E06 = Date.parse(T06)
const E12 = Date.parse(T12)

function Harness({
  expose,
  ttlMs,
  pruneIntervalMs,
}: {
  expose: (log: GetMapFailureLog) => void
  ttlMs?: number
  pruneIntervalMs?: number
}) {
  const log = useGetMapFailureLog({ ttlMs, pruneIntervalMs })
  expose(log)
  return (
    <output data-testid="a">{JSON.stringify([...log.failedEpochs.a])}</output>
  )
}

describe('useGetMapFailureLog', () => {
  it('marks failures per slot, clears on success and clearSlot', async () => {
    let log!: GetMapFailureLog
    await render(<Harness expose={(l) => (log = l)} />)

    await act(() => {
      log.report('a', '2t', T06, false)
    })
    await act(() => {
      log.report('b', '2t', T12, false)
    })
    expect([...log.failedEpochs.a]).toEqual([E06])
    expect([...log.failedEpochs.b]).toEqual([E12])

    // Success clears exactly the failing (layer, epoch) pair.
    await act(() => {
      log.report('a', '2t', T06, true)
    })
    expect(log.failedEpochs.a.size).toBe(0)
    expect([...log.failedEpochs.b]).toEqual([E12])

    await act(() => {
      log.clearSlot('b')
    })
    expect(log.failedEpochs.b.size).toBe(0)
  })

  it('keeps an epoch marked until every failing layer recovered', async () => {
    let log!: GetMapFailureLog
    await render(<Harness expose={(l) => (log = l)} />)

    await act(() => {
      log.report('a', '2t', T06, false)
    })
    await act(() => {
      log.report('a', 'msl', T06, false)
    })
    await act(() => {
      log.report('a', '2t', T06, true)
    })
    expect([...log.failedEpochs.a]).toEqual([E06])

    await act(() => {
      log.report('a', 'msl', T06, true)
    })
    expect(log.failedEpochs.a.size).toBe(0)
  })

  it('re-failing an already-marked instant does not churn state', async () => {
    let log!: GetMapFailureLog
    await render(<Harness expose={(l) => (log = l)} />)

    await act(() => {
      log.report('a', '2t', T06, false)
    })
    const before = log.failedEpochs
    await act(() => {
      log.report('a', '2t', T06, false)
    })
    // Same identity → no re-render → no retry-loop fuel.
    expect(log.failedEpochs).toBe(before)
  })

  it('ignores unparseable or missing times', async () => {
    let log!: GetMapFailureLog
    await render(<Harness expose={(l) => (log = l)} />)

    await act(() => {
      log.report('a', '2t', null, false)
    })
    await act(() => {
      log.report('a', '2t', 'not-a-date', false)
    })
    expect(log.failedEpochs.a.size).toBe(0)
  })

  it('expires marks after the TTL', async () => {
    let log!: GetMapFailureLog
    const screen = await render(
      <Harness expose={(l) => (log = l)} ttlMs={80} pruneIntervalMs={20} />,
    )

    await act(() => {
      log.report('a', '2t', T06, false)
    })
    expect(log.failedEpochs.a.size).toBe(1)

    await expect
      .poll(() => screen.getByTestId('a').element().textContent, {
        timeout: 3000,
      })
      .toBe('[]')
  })
})
