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
 * GeoTimeSlider failure marks: "advertised but not served" instants paint
 * destructively on the availability tracks, in both the discrete-cell and
 * merged-run rendering modes.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nextProvider } from 'react-i18next'
import type { SourceSlot } from '@/features/viewer/geo/layer-pairing'
import { GeoTimeSlider } from '@/features/viewer/geo/GeoTimeSlider'
import i18n from '@/lib/i18n'

const HOUR = 3600_000
const T0 = Date.parse('2026-07-06T00:00:00Z')

const noop = () => {}

function renderSlider(stepCount: number, failedAt: ReadonlyArray<number>) {
  const epochs = Array.from({ length: stepCount }, (_, i) => T0 + i * HOUR)
  const available = epochs.map(() => true)
  const failed = epochs.map((_, i) => failedAt.includes(i))
  const timeline = {
    epochs,
    availability: { a: available, b: available },
    intersectionCount: stepCount,
  }
  const failures: Record<SourceSlot, ReadonlyArray<boolean>> = {
    a: failed,
    b: epochs.map(() => false),
  }
  const axis = { epochs, index: 0, onChange: noop }
  return render(
    <I18nextProvider i18n={i18n}>
      <GeoTimeSlider
        hasB={false}
        timeline={timeline}
        failures={failures}
        index={0}
        onChange={noop}
        linkMode="exact"
        onLinkModeChange={noop}
        offsetMs={0}
        onOffsetChange={noop}
        offsetMeta={{
          minMs: 0,
          maxMs: 0,
          stepMs: HOUR,
          alignStartsMs: null,
          alignEndsMs: null,
        }}
        independent={{ a: axis, b: axis }}
        clip={null}
        onClipChange={noop}
        hoverTimes={() => null}
      />
    </I18nextProvider>,
  )
}

const MARK_SELECTOR = '[title="Advertised but not served"]'

describe('GeoTimeSlider failure marks', () => {
  it('paints failed instants as light slot-tinted cells with a tooltip', async () => {
    const { container } = await renderSlider(6, [2])
    const marks = container.querySelectorAll(MARK_SELECTOR)
    expect(marks).toHaveLength(1)
    expect(marks[0].className).toContain('bg-blue-300')
  })

  it('groups failed instants into their own runs beyond the cell limit', async () => {
    // 300 steps > TRACK_CELL_LIMIT → merged runs; 5 failing in a row.
    const { container } = await renderSlider(300, [100, 101, 102, 103, 104])
    const marks = container.querySelectorAll(MARK_SELECTOR)
    expect(marks).toHaveLength(1)
    expect(marks[0].className).toContain('bg-blue-300')
  })

  it('explains the light tint in the panel header only when marks exist', async () => {
    const hint =
      'Light segments: times this server advertises but did not serve'
    const withFailures = await renderSlider(6, [2])
    expect(withFailures.getByText(hint).element()).toBeTruthy()

    const clean = await renderSlider(6, [])
    expect(clean.container.textContent).not.toContain(hint)
  })
})
