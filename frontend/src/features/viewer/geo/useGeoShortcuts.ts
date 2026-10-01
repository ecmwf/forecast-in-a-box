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
 *   F          fit view
 *   C          copy the view to the clipboard
 *   E          export dialog
 *   H          help dialog
 *   N          toggle the annotate tool (Esc disarms)
 *   W/A/S/D    pan the map (arrow keys too)
 *   + / -      zoom in / out one step
 * Space (flicker) and hold-Z (loupe) live with their features; the swipe
 * divider consumes its own arrow keys while focused (the pan guard
 * yields to it).
 */

import { useEffect, useEffectEvent } from 'react'
import {
  formatForDisplay,
  useHotkey,
  useKeyHold,
} from '@tanstack/react-hotkeys'
import { NAV_ZOOM_STEP } from './map-nav'
import { COMPARE_MODES } from './types'
import type { CompareMode } from './types'
import { useHoldPan } from '@/hooks/useHoldPan'

/** The viewer's keymap — badges, tooltips, and help all render from it. */
export const COMPARE_KEYS = {
  sidebars: 'B',
  fit: 'F',
  projection: 'P',
  copy: 'C',
  export: 'E',
  help: 'H',
  annotate: 'N',
  /** Hold-to-magnify (handled in LoupeOverlay, not via useHotkey). */
  loupe: 'Z',
  modes: ['1', '2', '3', '4', '5'],
  pan: ['W', 'A', 'S', 'D'],
  /** Raw keydown, not useHotkey: '+' needs Shift on some layouts, which hotkey matching rejects. */
  zoom: ['+', '-'],
} as const

const ZOOM_DIRECTION: Partial<Record<string, number>> = {
  '+': 1,
  '=': 1,
  '-': -1,
  _: -1,
}

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

/** Letter keys yield to open dialogs — C must not copy behind a modal. */
function dialogOpen(): boolean {
  return (
    document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
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
  /** Next available map projection. */
  onProjectionCycle: () => void
  onCopy: () => void
  onExport: () => void
  onHelp: () => void
  onAnnotate: () => void
  /** Disarm the annotate tool; active only while it's armed (and the
   *  editor dialog is closed — the dialog owns Escape when open). */
  onAnnotateDisarm: { enabled: boolean; disarm: () => void }
  /** Pan the shared camera by (dx, dy) screen pixels. */
  onPan: (dx: number, dy: number) => void
  /** Zoom the shared camera by `delta` levels. */
  onZoom: (delta: number) => void
}): void {
  const {
    onToggleSidebars,
    onMode,
    onFit,
    onProjectionCycle,
    onCopy,
    onExport,
    onHelp,
    onAnnotate,
    onAnnotateDisarm,
    onPan,
    onZoom,
  } = handlers
  const opts = { ignoreInputs: true }
  const gated = (fn: () => void) => () => {
    if (!dialogOpen()) fn()
  }

  useHotkey(COMPARE_KEYS.sidebars, gated(onToggleSidebars), opts)
  useHotkey(
    COMPARE_KEYS.modes[0],
    gated(() => onMode(COMPARE_MODES[0])),
    opts,
  )
  useHotkey(
    COMPARE_KEYS.modes[1],
    gated(() => onMode(COMPARE_MODES[1])),
    opts,
  )
  useHotkey(
    COMPARE_KEYS.modes[2],
    gated(() => onMode(COMPARE_MODES[2])),
    opts,
  )
  useHotkey(
    COMPARE_KEYS.modes[3],
    gated(() => onMode(COMPARE_MODES[3])),
    opts,
  )
  useHotkey(
    COMPARE_KEYS.modes[4],
    gated(() => onMode(COMPARE_MODES[4])),
    opts,
  )
  useHotkey(
    COMPARE_KEYS.fit,
    gated(() => onFit?.()),
    opts,
  )
  useHotkey(COMPARE_KEYS.projection, gated(onProjectionCycle), opts)
  useHotkey(COMPARE_KEYS.copy, gated(onCopy), opts)
  useHotkey(COMPARE_KEYS.export, gated(onExport), opts)
  useHotkey(COMPARE_KEYS.help, gated(onHelp), opts)
  useHotkey(COMPARE_KEYS.annotate, gated(onAnnotate), opts)
  useHotkey('Escape', () => onAnnotateDisarm.disarm(), {
    ...opts,
    enabled: onAnnotateDisarm.enabled,
  })
  useHoldPan(onPan, { arrows: true, isBlocked: panBlocked })

  // One step per press, flat or globe: key repeat is ignored.
  const zoomKey = useEffectEvent((e: KeyboardEvent) => {
    const direction = ZOOM_DIRECTION[e.key]
    if (!direction || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target as HTMLElement | null
    if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (panBlocked() || dialogOpen()) return
    e.preventDefault()
    onZoom(direction * NAV_ZOOM_STEP)
  })
  useEffect(() => {
    const down = (e: KeyboardEvent) => zoomKey(e)
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
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
