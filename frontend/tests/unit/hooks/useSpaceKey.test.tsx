/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useSpaceKey } from '@/hooks/useSpaceKey'

function Viewer(props: {
  onSpace: () => void
  onInside: () => void
  onOutside: () => void
}) {
  useSpaceKey(props.onSpace, { enabled: true, scope: '[data-test-viewer]' })
  return (
    <>
      <button type="button" onClick={props.onOutside}>
        Outside
      </button>
      <div data-test-viewer="">
        <button type="button" onClick={props.onInside}>
          Inside
        </button>
        <input aria-label="Search" />
        <input type="range" aria-label="Time" />
        <span
          role="switch"
          aria-checked="false"
          aria-label="Link"
          tabIndex={0}
        />
      </div>
    </>
  )
}

const ROLES: Partial<Record<string, 'textbox' | 'switch' | 'slider'>> = {
  Search: 'textbox',
  Link: 'switch',
  Time: 'slider',
}

async function setup() {
  const fns = { onSpace: vi.fn(), onInside: vi.fn(), onOutside: vi.fn() }
  const screen = await render(<Viewer {...fns} />)
  const focus = (name: string) =>
    (
      screen
        .getByRole(ROLES[name] ?? 'button', { name })
        .element() as HTMLElement
    ).focus()
  return { ...fns, focus }
}

describe('useSpaceKey', () => {
  let cleanup: (() => void) | null = null
  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  it('runs over a focused button in the viewer without clicking it', async () => {
    const { onSpace, onInside, focus } = await setup()
    focus('Inside')
    await userEvent.keyboard(' ')
    expect(onSpace).toHaveBeenCalledOnce()
    expect(onInside).not.toHaveBeenCalled()
  })

  it('runs when another listener already prevented Space', async () => {
    // React Flow's hold-Space-to-pan prevents every Space on window.
    const prevent = (e: KeyboardEvent) => e.preventDefault()
    window.addEventListener('keydown', prevent)
    cleanup = () => window.removeEventListener('keydown', prevent)
    const { onSpace, focus } = await setup()
    focus('Inside')
    await userEvent.keyboard(' ')
    expect(onSpace).toHaveBeenCalledOnce()
  })

  it('runs over a focused slider, which has no use for Space', async () => {
    const { onSpace, focus } = await setup()
    focus('Time')
    await userEvent.keyboard(' ')
    expect(onSpace).toHaveBeenCalledOnce()
  })

  it('leaves Space to outside buttons, text fields and switches', async () => {
    const { onSpace, onOutside, focus } = await setup()
    focus('Outside')
    await userEvent.keyboard(' ')
    expect(onOutside).toHaveBeenCalledOnce()
    focus('Search')
    await userEvent.keyboard(' ')
    focus('Link')
    await userEvent.keyboard(' ')
    expect(onSpace).not.toHaveBeenCalled()
  })
})
