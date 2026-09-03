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
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { CollapsedSidebarHandle } from '@/components/common/CollapsedSidebarHandle'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useUiPreferencesStore } from '@/features/fable-builder/stores/uiPreferencesStore'
import { SplitHandleChrome } from '@/components/common/SplitResizeHandle'
import { TOUR, tourAttr } from '@/features/tutorials/anchors'
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
      const strip = e.currentTarget as HTMLElement
      strip.setAttribute('data-dragging', '')
      startXRef.current = e.clientX
      startWidthRef.current = getCurrentWidth()
      let moved = false

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current
        if (Math.abs(delta) > 3) moved = true
        // Left sidebar: drag right = wider. Right sidebar: drag left = wider.
        const newWidth =
          direction === 'left'
            ? startWidthRef.current + delta
            : startWidthRef.current - delta
        setWidth(newWidth)
      }

      const onUp = () => {
        strip.removeAttribute('data-dragging')
        // Only a clean click selects (shows the steppers); a drag never pins them.
        if (!moved) strip.focus()
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
  const { t } = useTranslation('configure')
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
      {!isPaletteOpen && (
        <CollapsedSidebarHandle
          side="left"
          onExpand={togglePalette}
          label={t('layout.showBlockPalette')}
          buttonAttrs={tourAttr(TOUR.configure.expandPalette)}
        />
      )}

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
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layout.resizeSidebar')}
            aria-valuenow={Math.round(leftWidth)}
            tabIndex={0}
            onPointerDown={onLeftResize}
            onDoubleClick={resetLeftWidth}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                setLeftWidth(leftWidth + (e.key === 'ArrowRight' ? 16 : -16))
              }
            }}
            className="group/split absolute inset-y-0 -left-1 z-20 w-3 cursor-col-resize outline-none hover:bg-primary/10 focus-visible:bg-primary/10 active:bg-primary/20"
          >
            <SplitHandleChrome
              onNudge={(direction) => setLeftWidth(leftWidth + direction * 48)}
            />
          </div>
        )}
      </div>

      {/* Canvas */}
      <main className="min-w-0 flex-1 overflow-hidden">{canvas}</main>

      {/* Right resize + toggle handle */}
      <div className="relative shrink-0">
        {isConfigPanelOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layout.resizeSidebar')}
            aria-valuenow={Math.round(rightWidth)}
            tabIndex={0}
            onPointerDown={onRightResize}
            onDoubleClick={resetRightWidth}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                setRightWidth(rightWidth + (e.key === 'ArrowLeft' ? 16 : -16))
              }
            }}
            className="group/split absolute inset-y-0 -right-1 z-20 w-3 cursor-col-resize outline-none hover:bg-primary/10 focus-visible:bg-primary/10 active:bg-primary/20"
          >
            <SplitHandleChrome
              onNudge={(direction) =>
                setRightWidth(rightWidth - direction * 48)
              }
            />
          </div>
        )}
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

      {!isConfigPanelOpen && (
        <CollapsedSidebarHandle
          side="right"
          onExpand={toggleConfigPanel}
          label={t('layout.showConfigPanel')}
          buttonAttrs={tourAttr(TOUR.configure.expandConfig)}
        />
      )}
    </div>
  )
}
