/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect } from 'react'
import { getKeyStateTracker } from '@tanstack/react-hotkeys'

/** Continuous pan speed (px/s) while a pan key is held. */
const PAN_SPEED_PX_PER_SEC = 900
/** Cap per-frame dt so a backgrounded tab doesn't lurch on return. */
const MAX_FRAME_S = 0.05

const WASD: Record<string, [number, number]> = {
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
}

/** Fields that take typed keys: not sliders, toggles or buttons. */
const TEXT_ENTRY = [
  'input:not([type=range],[type=checkbox],[type=radio],[type=button],[type=submit],[type=reset],[type=color],[type=file])',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable=false])',
].join(',')

/** True when keys pressed at `target` go into a text field. */
export function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_ENTRY) !== null
}

const ARROWS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
}

/** Hold WASD (optionally arrows) to pan smoothly; OS key-repeat is choppy. */
export function useHoldPan(
  onPan: (dx: number, dy: number) => void,
  options: {
    arrows: boolean
    /** Gets the lower-cased key: e.g. a focused slider blocks only arrows. */
    isBlocked?: (key: string) => boolean
  },
): void {
  const { arrows, isBlocked } = options
  useEffect(() => {
    const vec = arrows ? { ...WASD, ...ARROWS } : WASD
    // TanStack's tracker clears keyups the OS swallows during ⌘-chords.
    const tracker = getKeyStateTracker()
    // Armed = passed the gates on keydown; panning needs armed AND held.
    // Values keep e.key: the tracker matches named keys case-sensitively.
    const armed = new Map<string, string>()
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      for (const [k, key] of armed) if (!tracker.isKeyHeld(key)) armed.delete(k)
      const dt = last ? Math.min(MAX_FRAME_S, (t - last) / 1000) : 0
      last = t
      let dx = 0
      let dy = 0
      for (const k of armed.keys()) {
        dx += vec[k][0]
        dy += vec[k][1]
      }
      if (dx || dy) {
        onPan(dx * PAN_SPEED_PX_PER_SEC * dt, dy * PAN_SPEED_PX_PER_SEC * dt)
      }
      if (armed.size) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
        last = 0
      }
    }
    const down = (e: KeyboardEvent) => {
      // Modifier chords (⌘A, ⌥←, …) belong to the browser, never the pan.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (!(k in vec) || isBlocked?.(k) || isTextEntry(e.target)) return
      e.preventDefault()
      armed.set(k, e.key)
      if (!raf) raf = requestAnimationFrame(tick)
    }
    window.addEventListener('keydown', down)
    return () => {
      window.removeEventListener('keydown', down)
      cancelAnimationFrame(raf)
    }
  }, [onPan, arrows, isBlocked])
}
