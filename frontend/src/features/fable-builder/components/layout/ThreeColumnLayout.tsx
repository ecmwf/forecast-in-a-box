/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { PanelToggleHandle } from './PanelToggleHandle'
import type { ReactNode } from 'react'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { cn } from '@/lib/utils'

interface ThreeColumnLayoutProps {
  leftSidebar: ReactNode
  canvas: ReactNode
  rightSidebar: ReactNode
}

export function ThreeColumnLayout({
  leftSidebar,
  canvas,
  rightSidebar,
}: ThreeColumnLayoutProps): ReactNode {
  const isPaletteOpen = useFableBuilderStore((s) => s.isPaletteOpen)
  const isConfigPanelOpen = useFableBuilderStore((s) => s.isConfigPanelOpen)
  const togglePalette = useFableBuilderStore((s) => s.togglePalette)
  const toggleConfigPanel = useFableBuilderStore((s) => s.toggleConfigPanel)

  return (
    <div className="relative flex h-full min-h-0 w-full">
      {/* Left margin zone when sidebar closed */}
      <div
        className={cn(
          'relative shrink-0 transition-all duration-200',
          isPaletteOpen ? 'w-0' : 'w-4 sm:w-6',
        )}
      />

      {/* Left Panel */}
      <aside
        className={cn(
          'z-10 shrink-0 overflow-hidden border-r border-border bg-card transition-all duration-200 ease-in-out',
          isPaletteOpen ? 'w-64' : 'w-0',
        )}
      >
        <div className="h-full w-64 overflow-y-auto">{leftSidebar}</div>
      </aside>

      {/* Left toggle handle - positioned at the border */}
      <div className="relative shrink-0">
        <PanelToggleHandle
          isOpen={isPaletteOpen}
          onToggle={togglePalette}
          position="left"
          label={isPaletteOpen ? 'Hide block palette' : 'Show block palette'}
        />
      </div>

      {/* Canvas */}
      <main className="min-w-0 flex-1 overflow-hidden">{canvas}</main>

      {/* Right toggle handle - positioned at the border */}
      <div className="relative shrink-0">
        <PanelToggleHandle
          isOpen={isConfigPanelOpen}
          onToggle={toggleConfigPanel}
          position="right"
          label={isConfigPanelOpen ? 'Hide config panel' : 'Show config panel'}
        />
      </div>

      {/* Right Panel */}
      <aside
        className={cn(
          'z-10 shrink-0 overflow-hidden border-l border-border bg-card transition-all duration-200 ease-in-out',
          isConfigPanelOpen ? 'w-80' : 'w-0',
        )}
      >
        <div className="h-full w-80 overflow-y-auto">{rightSidebar}</div>
      </aside>

      {/* Right margin zone when sidebar closed */}
      <div
        className={cn(
          'relative shrink-0 transition-all duration-200',
          isConfigPanelOpen ? 'w-0' : 'w-4 sm:w-6',
        )}
      />
    </div>
  )
}
