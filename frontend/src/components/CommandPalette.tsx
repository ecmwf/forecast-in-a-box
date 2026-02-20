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
 * Command Palette Component
 *
 * Global command palette accessible via ⌘K (Mac) or Ctrl+K (Windows/Linux).
 * Provides quick access to Getting Started presets and navigation.
 */

import { useEffect, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Command } from '@/commands'
import { groupCommandsByCategory, navigationCommands } from '@/commands'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useCommandStore } from '@/stores/commandStore'

export function CommandPalette() {
  const navigate = useNavigate()
  const { isOpen, setOpen } = useCommandStore()

  // Build commands with navigate function
  const commands = useMemo(() => navigationCommands(navigate), [navigate])
  const groupedCommands = useMemo(
    () => groupCommandsByCategory(commands),
    [commands],
  )

  // Listen for ⌘K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!isOpen)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, setOpen])

  const handleSelect = (command: Command) => {
    setOpen(false)
    command.action()
  }

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {groupedCommands.map((group) => (
          <CommandGroup key={group.category} heading={group.category}>
            {group.commands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                keywords={command.keywords}
                onSelect={() => handleSelect(command)}
              >
                {command.icon}
                <div className="flex flex-col gap-0.5">
                  <span>{command.label}</span>
                  {command.description && (
                    <span className="text-xs text-muted-foreground">
                      {command.description}
                    </span>
                  )}
                </div>
                {command.shortcut && (
                  <CommandShortcut>{command.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
