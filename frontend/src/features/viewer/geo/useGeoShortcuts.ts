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

/** Pixels per pan keypress (matches OL's KeyboardPan default feel). */
const PAN_STEP_PX = 128

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
  const pan = (dx: number, dy: number) => {
    if (!panBlocked()) onPan(dx * PAN_STEP_PX, dy * PAN_STEP_PX)
  }

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
  useHotkey(COMPARE_KEYS.pan[0], () => pan(0, -1), opts)
  useHotkey(COMPARE_KEYS.pan[1], () => pan(-1, 0), opts)
  useHotkey(COMPARE_KEYS.pan[2], () => pan(0, 1), opts)
  useHotkey(COMPARE_KEYS.pan[3], () => pan(1, 0), opts)
  useHotkey('ArrowUp', () => pan(0, -1), opts)
  useHotkey('ArrowLeft', () => pan(-1, 0), opts)
  useHotkey('ArrowDown', () => pan(0, 1), opts)
  useHotkey('ArrowRight', () => pan(1, 0), opts)
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
