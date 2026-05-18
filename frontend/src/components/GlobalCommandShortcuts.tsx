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
 * Global Command Shortcuts
 *
 * Registers app-wide keyboard sequences (e.g. `g` then `d`) for the navigation
 * commands that declare a `hotkey`. Each command is bound by its own child
 * component so `useHotkeySequence` is always called unconditionally (Rules of
 * Hooks). Renders no DOM.
 *
 * `@tanstack/react-hotkeys` ignores single-key sequences while a text input is
 * focused, so these never fire mid-typing — including inside the command
 * palette's search field.
 */

import { useMemo } from 'react'
import { useHotkeySequence } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import type { Command } from '@/commands/registry'
import { navigationCommands } from '@/commands/navigationCommands'

type CommandWithHotkey = Command & { hotkey: NonNullable<Command['hotkey']> }

/** Binds a single command's key sequence. Renders nothing. */
function CommandHotkey({ command }: { command: CommandWithHotkey }) {
  useHotkeySequence(command.hotkey, command.action)
  return null
}

export function GlobalCommandShortcuts() {
  const navigate = useNavigate()
  const commands = useMemo(() => navigationCommands(navigate), [navigate])

  return (
    <>
      {commands
        .filter(
          (command): command is CommandWithHotkey => command.hotkey != null,
        )
        .map((command) => (
          <CommandHotkey key={command.id} command={command} />
        ))}
    </>
  )
}
