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
 * Built on Base UI Autocomplete — provides quick access to Getting Started
 * presets and navigation.
 */

import { useMemo, useRef, useState } from 'react'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { Command, CommandCategory } from '@/commands/registry'
import { groupCommandsByCategory } from '@/commands/registry'
import { navigationCommands } from '@/commands/navigationCommands'
import {
  useBlockCommands,
  usePresetCommands,
  useRunCommands,
} from '@/commands/dataCommands'
import {
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  Command as CommandRoot,
  CommandShortcut,
} from '@/components/ui/command'
import { useCommandStore } from '@/stores/commandStore'

/** A category of commands, shaped for Base UI Autocomplete's grouped `items`. */
interface CommandPaletteGroup {
  value: CommandCategory
  items: Array<Command>
}

/**
 * Matches a command against the search query across its label, description and
 * keyword aliases. Every whitespace-separated term must appear somewhere.
 */
function commandFilter(command: Command, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return true

  const haystack = [
    command.label,
    command.description ?? '',
    ...(command.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase()

  return trimmed.split(/\s+/).every((term) => haystack.includes(term))
}

export function CommandPalette() {
  const { isOpen, setOpen } = useCommandStore()

  // Listen for ⌘K / Ctrl+K. Mod+K covers ⌘ on Mac and Ctrl elsewhere;
  // Control+K ensures Ctrl+K also works on Mac for consistency.
  const toggle = () => setOpen(!isOpen)
  useHotkey('Mod+K', toggle)
  useHotkey('Control+K', toggle)

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      {isOpen && <CommandPaletteContent />}
    </CommandDialog>
  )
}

/** Mounted only while open, so the preset and run queries stay idle otherwise. */
function CommandPaletteContent() {
  const navigate = useNavigate()
  const setOpen = useCommandStore((state) => state.setOpen)
  const { t } = useTranslation('common')
  const onConfigure = useRouterState({
    select: (state) => state.location.pathname.startsWith('/configure'),
  })

  // Category headings are union values used for grouping; map them to labels.
  const categoryLabels: Record<CommandCategory, string> = {
    'Getting Started': t('commands.categoryGettingStarted'),
    Navigation: t('commands.categoryNavigation'),
    Presets: t('commands.categoryPresets'),
    Runs: t('commands.categoryRuns'),
    Blocks: t('commands.categoryBlocks'),
  }

  // Tracks the highlighted command so Tab can confirm it, mirroring Enter.
  const highlightedCommand = useRef<Command | undefined>(undefined)

  // Base UI skips the filter on an empty query, so search-only commands are
  // dropped from the item list itself until the user types.
  const [query, setQuery] = useState('')
  const pages = useMemo(() => navigationCommands(navigate), [navigate])
  const presets = usePresetCommands(navigate)
  const runs = useRunCommands(navigate)
  const blocks = useBlockCommands(onConfigure)
  const groups = useMemo<Array<CommandPaletteGroup>>(() => {
    const all = [...pages, ...presets, ...runs, ...blocks]
    const listed = query.trim()
      ? all
      : all.filter((command) => !command.searchOnly)
    return groupCommandsByCategory(listed).map((group) => ({
      value: group.category,
      items: group.commands,
    }))
  }, [pages, presets, runs, blocks, query])

  const handleSelect = (command: Command) => {
    setOpen(false)
    command.action()
  }

  return (
    <CommandRoot
      open
      inline
      items={groups}
      value={query}
      onValueChange={setQuery}
      autoHighlight="always"
      keepHighlight
      filter={commandFilter}
      itemToStringValue={(command: Command) => command.label}
      onItemHighlighted={(command) => {
        highlightedCommand.current = command
      }}
    >
      <CommandInput
        placeholder={t('commandPalette.placeholder')}
        onKeyDown={(event) => {
          // Tab confirms the highlighted command, mirroring Enter.
          if (event.key === 'Tab' && highlightedCommand.current) {
            event.preventDefault()
            handleSelect(highlightedCommand.current)
          }
        }}
      />
      <CommandEmpty>{t('commandPalette.empty')}</CommandEmpty>
      <CommandList>
        {(group: CommandPaletteGroup) => (
          <CommandGroup key={group.value} items={group.items}>
            <CommandGroupLabel>{categoryLabels[group.value]}</CommandGroupLabel>
            <CommandCollection>
              {(command: Command) => (
                <CommandItem
                  key={command.id}
                  value={command}
                  onClick={() => handleSelect(command)}
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
                  {command.hotkey && (
                    <CommandShortcut
                      keys={command.hotkey.map((key) => formatForDisplay(key))}
                    />
                  )}
                </CommandItem>
              )}
            </CommandCollection>
          </CommandGroup>
        )}
      </CommandList>
      <CommandFooter />
    </CommandRoot>
  )
}
