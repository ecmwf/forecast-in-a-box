/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Smoke test: the TanStack chart draws one bar per month bucket. */

import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import RunActivityChart from '@/features/dashboard/components/RunActivityChart'

const MONTHS = [
  { month: 'Mar', count: 0 },
  { month: 'Apr', count: 2 },
  { month: 'May', count: 5 },
  { month: 'Jun', count: 1 },
  { month: 'Jul', count: 8 },
  { month: 'Aug', count: 6 },
]

describe('RunActivityChart', () => {
  it('renders an accessible chart with a bar per month', async () => {
    const screen = await renderWithRouter(
      <div style={{ width: 480 }}>
        <RunActivityChart data={MONTHS} seriesName="Forecasts" />
      </div>,
    )

    await expect.element(screen.getByLabelText('Forecasts')).toBeVisible()
    // Five non-zero buckets paint gradient bars; labels render as SVG text.
    await expect
      .poll(() => document.querySelectorAll('rect[fill^="url("]').length)
      .toBeGreaterThanOrEqual(5)
    await expect
      .poll(() =>
        Array.from(document.querySelectorAll('svg text')).some((node) =>
          node.textContent.includes('Aug'),
        ),
      )
      .toBe(true)
  })
})
