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
 *   S      toggle both sidebars
 *   1–5    switch comparison mode
 *   F      fit to globe
 *   E      export dialog
 *   H      help dialog
 * Space (flicker) and hold-Z (loupe) live with their features; the swipe
 * divider handles its own arrow keys while focused.
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
  sidebars: 'S',
  fit: 'F',
  export: 'E',
  help: 'H',
  modes: ['1', '2', '3', '4', '5'],
} as const

/** Platform-aware display label for a hotkey (TanStack formatting). */
export function keyLabel(hotkey: string): string {
  return formatForDisplay(hotkey)
}

export function useCompareShortcuts(handlers: {
  onToggleSidebars: () => void
  onMode: (mode: CompareMode) => void
  onFit: (() => void) | null
  onExport: () => void
  onHelp: () => void
}): void {
  const { onToggleSidebars, onMode, onFit, onExport, onHelp } = handlers
  const opts = { ignoreInputs: true }

  useHotkey(COMPARE_KEYS.sidebars, () => onToggleSidebars(), opts)
  useHotkey(COMPARE_KEYS.modes[0], () => onMode(COMPARE_MODES[0]), opts)
  useHotkey(COMPARE_KEYS.modes[1], () => onMode(COMPARE_MODES[1]), opts)
  useHotkey(COMPARE_KEYS.modes[2], () => onMode(COMPARE_MODES[2]), opts)
  useHotkey(COMPARE_KEYS.modes[3], () => onMode(COMPARE_MODES[3]), opts)
  useHotkey(COMPARE_KEYS.modes[4], () => onMode(COMPARE_MODES[4]), opts)
  useHotkey(COMPARE_KEYS.fit, () => onFit?.(), opts)
  useHotkey(COMPARE_KEYS.export, () => onExport(), opts)
  useHotkey(COMPARE_KEYS.help, () => onHelp(), opts)
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
