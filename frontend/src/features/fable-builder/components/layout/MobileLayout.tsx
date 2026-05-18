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
import { useTranslation } from 'react-i18next'
import { BlockPalette } from './BlockPalette'
import { ConfigPanel } from './ConfigPanel'
import type { ReactNode } from 'react'

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

interface MobileLayoutProps {
  catalogue: BlockFactoryCatalogue
  canvas: ReactNode
}

export function MobileLayout({
  catalogue,
  canvas,
}: MobileLayoutProps): ReactNode {
  const { t } = useTranslation('configure')
  const isMobilePaletteOpen = useFableBuilderStore(
    (state) => state.isMobilePaletteOpen,
  )
  const setMobilePaletteOpen = useFableBuilderStore(
    (state) => state.setMobilePaletteOpen,
  )
  const isMobileConfigOpen = useFableBuilderStore(
    (state) => state.isMobileConfigOpen,
  )
  const setMobileConfigOpen = useFableBuilderStore(
    (state) => state.setMobileConfigOpen,
  )
  const fable = useFableBuilderStore((state) => state.fable)

  const blockCount = Object.keys(fable.blocks).length

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">{canvas}</div>

      {/* Add Block button - top left */}
      <div className="absolute top-4 left-4">
        <Sheet open={isMobilePaletteOpen} onOpenChange={setMobilePaletteOpen}>
          <SheetTrigger
            render={
              <Button
                size="icon"
                variant="secondary"
                className="h-9 w-9 rounded-lg shadow-sm"
              />
            }
          >
            <Plus className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('mobile.addBlock')}</SheetTitle>
            </SheetHeader>
            <div className="h-full">
              <BlockPalette catalogue={catalogue} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Block count indicator - top right */}
      {blockCount > 0 && (
        <div className="absolute top-4 right-4">
          <div className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-lg">
            {t('blockCount', { count: blockCount })}
          </div>
        </div>
      )}

      {/* Config panel sheet - controlled by store (opened from node settings button) */}
      <Sheet open={isMobileConfigOpen} onOpenChange={setMobileConfigOpen}>
        <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('mobile.blockConfiguration')}</SheetTitle>
          </SheetHeader>
          <div className="h-full">
            <ConfigPanel catalogue={catalogue} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
