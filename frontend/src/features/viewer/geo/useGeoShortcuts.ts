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
 * Compare-viewer keyboard shortcuts (TanStack Hotkeys, plain keys, never
 * inside form fields):
 *   B          toggle both sidebars
 *   1–5        switch comparison mode
 *   F          fit to globe
 *   C          copy the view to the clipboard
 *   E          export dialog
 *   H          help dialog
 *   N          toggle the annotate tool (Esc disarms)
 *   W/A/S/D    pan the map (arrow keys too)
 * Space (flicker) and hold-Z (loupe) live with their features; the swipe
 * divider consumes its own arrow keys while focused (the pan guard
 * yields to it).
 */

import { useEffect } from 'react'
import {
  formatForDisplay,
  useHotkey,
  useKeyHold,
} from '@tanstack/react-hotkeys'
import { COMPARE_MODES } from './types'
import type { CompareMode } from './types'

/** The viewer's keymap — badges, tooltips, and help all render from it. */
export const COMPARE_KEYS = {
  sidebars: 'B',
  fit: 'F',
  copy: 'C',
  export: 'E',
  help: 'H',
  annotate: 'N',
  modes: ['1', '2', '3', '4', '5'],
  pan: ['W', 'A', 'S', 'D'],
} as const

/** Continuous pan speed (px/s) while a WASD/arrow key is held. */
const PAN_SPEED_PX_PER_SEC = 900
/** Cap per-frame dt so a backgrounded tab doesn't lurch on return. */
const MAX_FRAME_S = 0.05

/**
 * Arrows/WASD must yield to widgets that consume them: the swipe
 * divider (role=slider), open selects/menus, dialogs. Plain inputs are
 * already excluded by ignoreInputs.
 */
function panBlocked(): boolean {
  const el = document.activeElement
  if (!el || el === document.body) return false
  return (
    el.closest(
      '[role="slider"], [role="listbox"], [role="option"], [role="menu"], [role="dialog"]',
    ) !== null
  )
}

/** Platform-aware display label for a hotkey (TanStack formatting). */
export function keyLabel(hotkey: string): string {
  return formatForDisplay(hotkey)
}

export function useGeoShortcuts(handlers: {
  onToggleSidebars: () => void
  onMode: (mode: CompareMode) => void
  onFit: (() => void) | null
  onCopy: () => void
  onExport: () => void
  onHelp: () => void
  onAnnotate: () => void
  /** Disarm the annotate tool; active only while it's armed (and the
   *  editor dialog is closed — the dialog owns Escape when open). */
  onAnnotateDisarm: { enabled: boolean; disarm: () => void }
  /** Pan the shared camera by (dx, dy) screen pixels. */
  onPan: (dx: number, dy: number) => void
}): void {
  const {
    onToggleSidebars,
    onMode,
    onFit,
    onCopy,
    onExport,
    onHelp,
    onAnnotate,
    onAnnotateDisarm,
    onPan,
  } = handlers
  const opts = { ignoreInputs: true }

  useHotkey(COMPARE_KEYS.sidebars, () => onToggleSidebars(), opts)
  useHotkey(COMPARE_KEYS.modes[0], () => onMode(COMPARE_MODES[0]), opts)
  useHotkey(COMPARE_KEYS.modes[1], () => onMode(COMPARE_MODES[1]), opts)
  useHotkey(COMPARE_KEYS.modes[2], () => onMode(COMPARE_MODES[2]), opts)
  useHotkey(COMPARE_KEYS.modes[3], () => onMode(COMPARE_MODES[3]), opts)
  useHotkey(COMPARE_KEYS.modes[4], () => onMode(COMPARE_MODES[4]), opts)
  useHotkey(COMPARE_KEYS.fit, () => onFit?.(), opts)
  useHotkey(COMPARE_KEYS.copy, () => onCopy(), opts)
  useHotkey(COMPARE_KEYS.export, () => onExport(), opts)
  useHotkey(COMPARE_KEYS.help, () => onHelp(), opts)
  useHotkey(COMPARE_KEYS.annotate, () => onAnnotate(), opts)
  useHotkey('Escape', () => onAnnotateDisarm.disarm(), {
    ...opts,
    enabled: onAnnotateDisarm.enabled,
  })
  // Continuous panning: hold WASD/arrows and a rAF loop moves the shared
  // camera at a constant velocity — OS key-repeat is laggy and choppy.
  useEffect(() => {
    const VEC: Record<string, [number, number]> = {
      w: [0, -1],
      s: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
      arrowleft: [-1, 0],
      arrowright: [1, 0],
    }
    const held = new Set<string>()
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      const dt = last ? Math.min(MAX_FRAME_S, (t - last) / 1000) : 0
      last = t
      let dx = 0
      let dy = 0
      for (const k of held) {
        dx += VEC[k][0]
        dy += VEC[k][1]
      }
      if (dx || dy) {
        onPan(dx * PAN_SPEED_PX_PER_SEC * dt, dy * PAN_SPEED_PX_PER_SEC * dt)
      }
      if (held.size) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
        last = 0
      }
    }
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!(k in VEC) || panBlocked()) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]'))
        return
      e.preventDefault()
      held.add(k)
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase())
    const blur = () => held.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      cancelAnimationFrame(raf)
    }
  }, [onPan])
}

/**
 * True while ⌘ (macOS) / Ctrl is held — the toolbar uses it to reveal
 * shortcut badges on its buttons (TanStack's global key-state tracker).
 */
export function useShortcutReveal(): boolean {
  const meta = useKeyHold('Meta')
  const control = useKeyHold('Control')
  return meta || control
}
