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
 * Continuous-pan keyboard handling: plain WASD/arrow holds pan via rAF;
 * modifier chords are the browser's; held-state comes from TanStack's
 * tracker so macOS-swallowed keyups and window blur cannot leave the
 * camera panning forever. +/- zoom one step per press. `?` shows the
 * toolbar's key badges until the next key, click or blur.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { HotkeysProvider, KeyStateTracker } from '@tanstack/react-hotkeys'
import { NAV_ZOOM_STEP } from '@/features/viewer/geo/map-nav'
import {
  useGeoShortcuts,
  useKeyBadges,
} from '@/features/viewer/geo/useGeoShortcuts'

const IDLE = {
  onToggleSidebars: () => {},
  onMode: () => {},
  onFit: null,
  onProjectionCycle: () => {},
  onCopy: () => {},
  onExport: () => {},
  onHelp: () => {},
  onToggleBadges: () => {},
  onAnnotate: () => {},
  onAnnotateDisarm: { enabled: false, disarm: () => {} },
  onPan: () => {},
  onZoom: () => {},
}

function Harness({
  onPan,
  onZoom,
}: {
  onPan: (dx: number, dy: number) => void
  onZoom: (delta: number) => void
}) {
  useGeoShortcuts({ ...IDLE, onPan, onZoom })
  return null
}

function BadgeHarness({ onCopy }: { onCopy: () => void }) {
  const badges = useKeyBadges()
  useGeoShortcuts({ ...IDLE, onCopy, onToggleBadges: badges.toggle })
  return badges.shown ? <kbd>badges</kbd> : null
}

function renderHarness(
  onPan: (dx: number, dy: number) => void,
  onZoom: (delta: number) => void = () => {},
) {
  return render(
    <HotkeysProvider>
      <Harness onPan={onPan} onZoom={onZoom} />
    </HotkeysProvider>,
  )
}

function pressKey(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  document.body.dispatchEvent(event)
  return event
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  KeyStateTracker.resetInstance()
})

describe('useGeoShortcuts continuous pan', () => {
  it('pans while a plain key is held and stops on release', async () => {
    const onPan = vi.fn()
    await renderHarness(onPan)

    pressKey('keydown', { key: 'a' })
    await expect.poll(() => onPan.mock.calls.length).toBeGreaterThan(2)
    // First frame has dt=0 → a zero-magnitude call; the rest move left.
    const calls = onPan.mock.calls as Array<[number, number]>
    expect(calls.every(([dx, dy]) => dx <= 0 && dy === 0)).toBe(true)
    expect(calls.some(([dx]) => dx < 0)).toBe(true)

    pressKey('keyup', { key: 'a' })
    await settle(100)
    const count = onPan.mock.calls.length
    await settle(200)
    expect(onPan.mock.calls.length).toBe(count)
  })

  it('leaves modifier chords to the browser', async () => {
    const onPan = vi.fn()
    await renderHarness(onPan)

    const cmdA = pressKey('keydown', { key: 'a', metaKey: true })
    const ctrlE = pressKey('keydown', { key: 'e', ctrlKey: true })
    await settle(150)

    expect(onPan).not.toHaveBeenCalled()
    expect(cmdA.defaultPrevented).toBe(false)
    expect(ctrlE.defaultPrevented).toBe(false)
  })

  it('cannot run away when macOS swallows the letter keyup', async () => {
    const onPan = vi.fn()
    await renderHarness(onPan)

    // 'a' held, then ⌘ pressed; the OS delivers no keyup for 'a' —
    // only ⌘'s keyup arrives, which must end the pan.
    pressKey('keydown', { key: 'a' })
    await expect.poll(() => onPan.mock.calls.length).toBeGreaterThan(0)
    pressKey('keydown', { key: 'Meta', metaKey: true })
    pressKey('keyup', { key: 'Meta' })

    await settle(100)
    const count = onPan.mock.calls.length
    await settle(200)
    expect(onPan.mock.calls.length).toBe(count)
  })

  it('stops panning when the window blurs', async () => {
    const onPan = vi.fn()
    await renderHarness(onPan)

    pressKey('keydown', { key: 'ArrowRight' })
    await expect.poll(() => onPan.mock.calls.length).toBeGreaterThan(0)
    window.dispatchEvent(new Event('blur'))

    await settle(100)
    const count = onPan.mock.calls.length
    await settle(200)
    expect(onPan.mock.calls.length).toBe(count)
  })
})

describe('useGeoShortcuts zoom keys', () => {
  it('zooms one step per press, whatever the layout needs Shift for', async () => {
    const onZoom = vi.fn()
    await renderHarness(() => {}, onZoom)

    // US '+' is Shift+'='; the bare '=' and '-' keys count too.
    const plus = pressKey('keydown', { key: '+', shiftKey: true })
    pressKey('keydown', { key: '=' })
    pressKey('keydown', { key: '-' })
    // Key repeat is ignored: one step per press.
    pressKey('keydown', { key: '-', repeat: true })

    const step = NAV_ZOOM_STEP
    expect(onZoom.mock.calls).toEqual([[step], [step], [-step]])
    expect(plus.defaultPrevented).toBe(true)
  })

  it('leaves browser zoom chords and text fields alone', async () => {
    const onZoom = vi.fn()
    await renderHarness(() => {}, onZoom)

    const cmdPlus = pressKey('keydown', { key: '=', metaKey: true })
    const input = document.createElement('input')
    document.body.append(input)
    try {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: '-', bubbles: true }),
      )
    } finally {
      input.remove()
    }

    expect(onZoom).not.toHaveBeenCalled()
    expect(cmdPlus.defaultPrevented).toBe(false)
  })
})

describe('useKeyBadges', () => {
  const press = (init: KeyboardEventInit) => {
    pressKey('keydown', init)
    pressKey('keyup', init)
  }
  const QUESTION = { key: '?', code: 'Slash', shiftKey: true }

  async function renderBadges(onCopy = () => {}) {
    return render(
      <HotkeysProvider>
        <BadgeHarness onCopy={onCopy} />
      </HotkeysProvider>,
    )
  }

  it('toggles on ? (typed with Shift) and off again', async () => {
    const screen = await renderBadges()
    press({ key: 'Shift', shiftKey: true })
    press(QUESTION)
    await expect.element(screen.getByText('badges')).toBeInTheDocument()
    // Shift on its way to the second ? leaves them up for the toggle.
    press({ key: 'Shift', shiftKey: true })
    await settle(50)
    await expect.element(screen.getByText('badges')).toBeInTheDocument()
    press(QUESTION)
    await expect.element(screen.getByText('badges')).not.toBeInTheDocument()
  })

  it('hides them on the next key, whose shortcut still runs', async () => {
    const onCopy = vi.fn()
    const screen = await renderBadges(onCopy)
    press(QUESTION)
    await expect.element(screen.getByText('badges')).toBeInTheDocument()
    press({ key: 'c' })
    await expect.element(screen.getByText('badges')).not.toBeInTheDocument()
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it('hides them on a click or when the window loses focus', async () => {
    const screen = await renderBadges()
    press(QUESTION)
    await expect.element(screen.getByText('badges')).toBeInTheDocument()
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    )
    await expect.element(screen.getByText('badges')).not.toBeInTheDocument()
    press(QUESTION)
    await expect.element(screen.getByText('badges')).toBeInTheDocument()
    window.dispatchEvent(new Event('blur'))
    await expect.element(screen.getByText('badges')).not.toBeInTheDocument()
  })
})
