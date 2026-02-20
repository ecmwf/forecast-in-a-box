/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Plus } from 'lucide-react'
import { BlockPalette } from '../layout/BlockPalette'
import { PanelToggleHandle } from '../layout/PanelToggleHandle'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface FormPaletteSidebarProps {
  catalogue: BlockFactoryCatalogue
}

/**
 * Left sidebar for the form builder showing the block palette.
 * - Desktop: Collapsible sidebar with toggle handle
 * - Mobile: Sheet (drawer) with floating button trigger
 */
export function FormPaletteSidebar({ catalogue }: FormPaletteSidebarProps) {
  const isPaletteOpen = useFableBuilderStore((state) => state.isPaletteOpen)
  const togglePalette = useFableBuilderStore((state) => state.togglePalette)
  const isMobilePaletteOpen = useFableBuilderStore(
    (state) => state.isMobilePaletteOpen,
  )
  const setMobilePaletteOpen = useFableBuilderStore(
    (state) => state.setMobilePaletteOpen,
  )

  return (
    <>
      {/* Desktop: Collapsible sidebar */}
      <div className="relative hidden md:flex">
        {/* Margin zone when closed - provides touch target */}
        <div
          className={cn(
            'relative shrink-0 transition-all duration-200 ease-in-out',
            isPaletteOpen ? 'w-0' : 'w-1.5',
          )}
        />

        {/* Sidebar panel */}
        <aside
          className={cn(
            'z-10 shrink-0 overflow-hidden border-r border-border bg-card transition-all duration-200 ease-in-out',
            isPaletteOpen ? 'w-64' : 'w-0',
          )}
        >
          <div className="h-full w-64 overflow-hidden">
            <BlockPalette catalogue={catalogue} />
          </div>
        </aside>

        {/* Toggle handle */}
        <PanelToggleHandle
          isOpen={isPaletteOpen}
          onToggle={togglePalette}
          position="left"
          label={isPaletteOpen ? 'Hide block palette' : 'Show block palette'}
        />
      </div>

      {/* Mobile: Floating button + Sheet */}
      <div className="absolute top-4 left-4 z-20 md:hidden">
        <Sheet open={isMobilePaletteOpen} onOpenChange={setMobilePaletteOpen}>
          <SheetTrigger
            render={
              <Button
                size="icon"
                variant="secondary"
                className="h-9 w-9 rounded-lg shadow-md"
              />
            }
          >
            <Plus className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Add Block</SheetTitle>
            </SheetHeader>
            <div className="h-full">
              <BlockPalette catalogue={catalogue} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
