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
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { SourceSlot } from '@/features/viewer/geo/layer-pairing'
import { GeoTimeSlider } from '@/features/viewer/geo/GeoTimeSlider'
import i18n from '@/lib/i18n'

const HOUR = 3600_000
const T0 = Date.parse('2026-07-06T00:00:00Z')

const noop = () => {}

function renderSlider(
  stepCount: number,
  failedAt: ReadonlyArray<number>,
  failedTitles: ReadonlyArray<string> = ['2 m temperature'],
  linkMode: 'exact' | 'offset' | 'independent' = 'exact',
) {
  const epochs = Array.from({ length: stepCount }, (_, i) => T0 + i * HOUR)
  const available = epochs.map(() => true)
  const failed = epochs.map((_, i) =>
    failedAt.includes(i) ? failedTitles : [],
  )
  const timeline = {
    epochs,
    availability: { a: available, b: available },
    intersectionCount: stepCount,
  }
  const failures: Record<SourceSlot, ReadonlyArray<ReadonlyArray<string>>> = {
    a: failed,
    b: epochs.map(() => []),
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
        linkMode={linkMode}
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

const MARK_SELECTOR = '[title^="Advertised but not served"]'

describe('GeoTimeSlider failure marks', () => {
  it('paints failed instants as light slot-tinted cells naming the layers', async () => {
    const { container } = await renderSlider(6, [2])
    const marks = container.querySelectorAll(MARK_SELECTOR)
    expect(marks).toHaveLength(1)
    expect(marks[0].className).toContain('bg-blue-300')
    expect(marks[0].getAttribute('title')).toBe(
      'Advertised but not served: 2 m temperature',
    )
  })

  it('groups failed instants into their own runs beyond the cell limit', async () => {
    // 300 steps > TRACK_CELL_LIMIT → merged runs; 5 failing in a row.
    const { container } = await renderSlider(300, [100, 101, 102, 103, 104])
    const marks = container.querySelectorAll(MARK_SELECTOR)
    expect(marks).toHaveLength(1)
    expect(marks[0].className).toContain('bg-blue-300')
    expect(marks[0].getAttribute('title')).toContain('2 m temperature')
  })

  it('explains the light tint in the panel header only when marks exist', async () => {
    const hint =
      'Light segments: times this server advertises but did not serve'
    const withFailures = await renderSlider(6, [2])
    expect(withFailures.getByText(hint).element()).toBeTruthy()

    const clean = await renderSlider(6, [])
    expect(clean.container.textContent).not.toContain(hint)
  })

  it('names the failing layers when the selected instant is affected', async () => {
    // index 0 is the selected instant in this harness.
    const atCurrent = await renderSlider(6, [0], ['2 m temperature', 'MSL'])
    expect(
      atCurrent
        .getByText('Not served at this time: 2 m temperature, MSL')
        .element(),
    ).toBeTruthy()

    // Failure elsewhere in the window keeps the generic wording.
    const elsewhere = await renderSlider(6, [2])
    expect(elsewhere.container.textContent).not.toContain(
      'Not served at this time',
    )
  })
})

describe('GeoTimeSlider solo link-mode leftovers', () => {
  it('renders leftover offset/independent modes as exact while solo', async () => {
    // B was removed while in offset mode — its controls must not linger.
    const offset = await renderSlider(6, [], [], 'offset')
    expect(offset.container.textContent).not.toContain('B offset')

    // Independent leftover must not split the solo axis into two sliders.
    const independent = await renderSlider(6, [], [], 'independent')
    expect(independent.getByRole('slider').elements().length).toBeGreaterThan(0)
    expect(independent.container.textContent).not.toContain('B offset')
  })
})

/** Stateful host: the slider's index lives here, shown for assertions. */
function KeyedSlider({ playKey = true }: { playKey?: boolean }) {
  const [index, setIndex] = useState(0)
  const epochs = Array.from({ length: 4 }, (_, i) => T0 + i * HOUR)
  const available = epochs.map(() => true)
  const axis = { epochs, index: 0, onChange: noop }
  return (
    <I18nextProvider i18n={i18n}>
      <span data-testid="index">{index}</span>
      <input aria-label="Search" />
      <GeoTimeSlider
        hasB={false}
        timeline={{
          epochs,
          availability: { a: available, b: available },
          intersectionCount: epochs.length,
        }}
        failures={{ a: epochs.map(() => []), b: epochs.map(() => []) }}
        index={index}
        onChange={setIndex}
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
        playKey={playKey}
      />
    </I18nextProvider>
  )
}

function press(key: string, target: Element = document.body) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key === ' ' ? 'Space' : '',
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('GeoTimeSlider keys', () => {
  it('steps with , and . like the transport buttons, wrapping around', async () => {
    const screen = await render(<KeyedSlider />)
    const index = screen.getByTestId('index')
    press('.')
    await expect.element(index).toHaveTextContent('1')
    press(',')
    await expect.element(index).toHaveTextContent('0')
    press(',')
    await expect.element(index).toHaveTextContent('3')
  })

  it('plays and pauses with Space', async () => {
    const screen = await render(<KeyedSlider />)
    press(' ')
    await expect
      .element(screen.getByRole('button', { name: /^Pause time/ }))
      .toBeVisible()
    press(' ')
    await expect
      .element(screen.getByRole('button', { name: /^Play time/ }))
      .toBeVisible()
  })

  it('leaves Space to flicker mode', async () => {
    const screen = await render(<KeyedSlider playKey={false} />)
    press(' ')
    await expect
      .element(screen.getByRole('button', { name: /^Play time/ }))
      .toBeVisible()
  })

  it('keeps working on a focused slider, but not in a text field', async () => {
    const screen = await render(<KeyedSlider />)
    const index = screen.getByTestId('index')
    const range = document.querySelector('input[type="range"]')
    expect(range).not.toBeNull()
    ;(range as HTMLElement).focus()
    press('.', range as Element)
    await expect.element(index).toHaveTextContent('1')
    const search = screen.getByRole('textbox', { name: 'Search' })
    ;(search.element() as HTMLElement).focus()
    const typed = press('.', search.element())
    expect(typed.defaultPrevented).toBe(false)
    await expect.element(index).toHaveTextContent('1')
  })
})
