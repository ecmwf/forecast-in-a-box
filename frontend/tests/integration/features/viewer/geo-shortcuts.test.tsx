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
 * camera panning forever.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { HotkeysProvider, KeyStateTracker } from '@tanstack/react-hotkeys'
import { useGeoShortcuts } from '@/features/viewer/geo/useGeoShortcuts'

function Harness({ onPan }: { onPan: (dx: number, dy: number) => void }) {
  useGeoShortcuts({
    onToggleSidebars: () => {},
    onMode: () => {},
    onFit: null,
    onCopy: () => {},
    onExport: () => {},
    onHelp: () => {},
    onAnnotate: () => {},
    onAnnotateDisarm: { enabled: false, disarm: () => {} },
    onPan,
  })
  return null
}

function renderHarness(onPan: (dx: number, dy: number) => void) {
  return render(
    <HotkeysProvider>
      <Harness onPan={onPan} />
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
