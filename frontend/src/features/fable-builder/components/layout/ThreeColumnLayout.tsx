/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { PanelToggleHandle } from './PanelToggleHandle'
import type { ReactNode } from 'react'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useUiPreferencesStore } from '@/features/fable-builder/stores/uiPreferencesStore'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ThreeColumnLayoutProps {
  leftSidebar: ReactNode
  canvas: ReactNode
  rightSidebar: ReactNode
}

/**
 * Hook for pointer-based sidebar resizing. Returns an onPointerDown handler
 * that tracks horizontal drag delta and calls the setter with the new width.
 */
function useResizeHandle(
  getCurrentWidth: () => number,
  setWidth: (width: number) => void,
  direction: 'left' | 'right',
) {
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  return useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      startXRef.current = e.clientX
      startWidthRef.current = getCurrentWidth()

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current
        // Left sidebar: drag right = wider. Right sidebar: drag left = wider.
        const newWidth =
          direction === 'left'
            ? startWidthRef.current + delta
            : startWidthRef.current - delta
        setWidth(newWidth)
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [getCurrentWidth, setWidth, direction],
  )
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

  const leftWidth = useUiPreferencesStore((s) => s.leftSidebarWidth)
  const rightWidth = useUiPreferencesStore((s) => s.rightSidebarWidth)
  const setLeftWidth = useUiPreferencesStore((s) => s.setLeftSidebarWidth)
  const setRightWidth = useUiPreferencesStore((s) => s.setRightSidebarWidth)
  const resetLeftWidth = useUiPreferencesStore((s) => s.resetLeftSidebarWidth)
  const resetRightWidth = useUiPreferencesStore((s) => s.resetRightSidebarWidth)

  const getLeftWidth = useCallback(() => leftWidth, [leftWidth])
  const getRightWidth = useCallback(() => rightWidth, [rightWidth])

  const onLeftResize = useResizeHandle(getLeftWidth, setLeftWidth, 'left')
  const onRightResize = useResizeHandle(getRightWidth, setRightWidth, 'right')

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
          'z-10 shrink-0 overflow-hidden border-r border-border bg-card transition-[width] duration-200 ease-in-out',
        )}
        style={{ width: isPaletteOpen ? leftWidth : 0 }}
      >
        <div className="h-full overflow-y-auto" style={{ width: leftWidth }}>
          {leftSidebar}
        </div>
      </aside>

      {/* Left resize + toggle handle */}
      <div className="relative shrink-0">
        {isPaletteOpen && (
          <div
            className="group/resize absolute inset-y-0 -left-1 z-20 w-3 cursor-col-resize hover:bg-primary/10 active:bg-primary/20"
            onPointerDown={onLeftResize}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className="absolute top-2 left-1/2 z-30 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card opacity-0 shadow-sm transition-opacity group-hover/resize:opacity-100 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation()
                      resetLeftWidth()
                    }}
                    aria-label="Reset sidebar width"
                  />
                }
              >
                <RotateCcw className="h-2.5 w-2.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right">Reset sidebar width</TooltipContent>
            </Tooltip>
          </div>
        )}
        <PanelToggleHandle
          isOpen={isPaletteOpen}
          onToggle={togglePalette}
          position="left"
          label={isPaletteOpen ? 'Hide block palette' : 'Show block palette'}
        />
      </div>

      {/* Canvas */}
      <main className="min-w-0 flex-1 overflow-hidden">{canvas}</main>

      {/* Right resize + toggle handle */}
      <div className="relative shrink-0">
        {isConfigPanelOpen && (
          <div
            className="group/resize absolute inset-y-0 -right-1 z-20 w-3 cursor-col-resize hover:bg-primary/10 active:bg-primary/20"
            onPointerDown={onRightResize}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className="absolute top-2 left-1/2 z-30 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card opacity-0 shadow-sm transition-opacity group-hover/resize:opacity-100 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation()
                      resetRightWidth()
                    }}
                    aria-label="Reset sidebar width"
                  />
                }
              >
                <RotateCcw className="h-2.5 w-2.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="left">Reset sidebar width</TooltipContent>
            </Tooltip>
          </div>
        )}
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
          'z-10 shrink-0 overflow-hidden border-l border-border bg-card transition-[width] duration-200 ease-in-out',
        )}
        style={{ width: isConfigPanelOpen ? rightWidth : 0 }}
      >
        <div className="h-full overflow-y-auto" style={{ width: rightWidth }}>
          {rightSidebar}
        </div>
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
