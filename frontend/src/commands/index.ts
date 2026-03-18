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
 * Command Registry
 *
 * Central registry for all command palette commands.
 * Commands are organized by category and can be filtered by route context.
 */

import type { ReactNode } from 'react'

/**
 * Command category for grouping in the palette
 */
export type CommandCategory = 'Getting Started' | 'Navigation'

/**
 * Command definition
 */
export interface Command {
  /** Unique identifier */
  id: string
  /** Display label */
  label: string
  /** Optional description */
  description?: string
  /** Optional icon */
  icon?: ReactNode
  /** Optional keyboard shortcut display (e.g., "⌘K") */
  shortcut?: string
  /** Category for grouping */
  category: CommandCategory
  /** Search keywords/aliases */
  keywords?: Array<string>
  /** Action to execute when selected */
  action: () => void
}

/**
 * Command group for rendering
 */
export interface CommandGroup {
  category: CommandCategory
  commands: Array<Command>
}

/**
 * Group commands by category
 */
export function groupCommandsByCategory(
  commands: Array<Command>,
): Array<CommandGroup> {
  const grouped = new Map<CommandCategory, Array<Command>>()

  for (const command of commands) {
    const existing = grouped.get(command.category) ?? []
    grouped.set(command.category, [...existing, command])
  }

  // Return in preferred order
  const order: Array<CommandCategory> = ['Getting Started', 'Navigation']

  return order
    .filter((category) => grouped.has(category))
    .map((category) => ({
      category,
      commands: grouped.get(category)!,
    }))
}

// Re-export navigation commands
export { navigationCommands } from './navigationCommands.tsx'
