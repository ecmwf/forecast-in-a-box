/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useHotkey } from '@tanstack/react-hotkeys'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

/**
 * Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (Ctrl+Y on Windows) drive the fable history.
 *
 * `ignoreInputs: true` is explicit because TanStack's default for Ctrl/Meta
 * combos lets the hotkey fire even in form fields — we want native
 * per-keystroke input undo to win while focus is in a config field, so the
 * user keeps character-level reversibility there.
 */
export function useUndoRedoShortcuts(enabled: boolean = true): void {
  const undo = useFableBuilderStore((s) => s.undo)
  const redo = useFableBuilderStore((s) => s.redo)

  useHotkey('Mod+Z', () => undo(), { enabled, ignoreInputs: true })
  useHotkey('Mod+Shift+Z', () => redo(), { enabled, ignoreInputs: true })
  // Windows-style redo. Harmless on Mac (where users wouldn't press it anyway).
  useHotkey('Control+Y', () => redo(), { enabled, ignoreInputs: true })
}
