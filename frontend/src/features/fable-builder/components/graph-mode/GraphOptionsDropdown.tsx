/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Lock, LockOpen, Map, MoreHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LayoutDirection } from '@/features/fable-builder/stores/fableBuilderStore'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function GraphOptionsDropdown() {
  const { t } = useTranslation('configure')
  const layoutDirection = useFableBuilderStore((s) => s.layoutDirection)
  const nodesLocked = useFableBuilderStore((s) => s.nodesLocked)
  const isMiniMapOpen = useFableBuilderStore((s) => s.isMiniMapOpen)
  const setLayoutDirection = useFableBuilderStore((s) => s.setLayoutDirection)
  const setNodesLocked = useFableBuilderStore((s) => s.setNodesLocked)
  const toggleMiniMap = useFableBuilderStore((s) => s.toggleMiniMap)
  const triggerLayout = useFableBuilderStore((s) => s.triggerLayout)
  const triggerFitView = useFableBuilderStore((s) => s.triggerFitView)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t('graphOptions.ariaLabel')}
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('graphOptions.view')}</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              triggerLayout()
              // Fit after the layout pass has committed.
              setTimeout(triggerFitView, 50)
            }}
          >
            <Sparkles />
            {t('graphOptions.tidyUp')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNodesLocked(!nodesLocked)}>
            {nodesLocked ? <Lock /> : <LockOpen />}
            {nodesLocked
              ? t('graphOptions.unlockNodes')
              : t('graphOptions.lockNodes')}
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={isMiniMapOpen}
            onCheckedChange={toggleMiniMap}
          >
            <Map />
            {t('graphOptions.showMinimap')}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('graphOptions.layout')}</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t('graphOptions.direction')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={layoutDirection}
                onValueChange={(value) =>
                  setLayoutDirection(value as LayoutDirection)
                }
              >
                <DropdownMenuRadioItem value="TB">
                  {t('graphOptions.topToBottom')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="LR">
                  {t('graphOptions.leftToRight')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
