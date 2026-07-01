/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import {
  FileText,
  LayoutGrid,
  Lock,
  LockOpen,
  Map,
  MoreHorizontal,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  EdgeStyle,
  LayoutDirection,
} from '@/features/fable-builder/stores/fableBuilderStore'
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
  const edgeStyle = useFableBuilderStore((s) => s.edgeStyle)
  const autoLayout = useFableBuilderStore((s) => s.autoLayout)
  const layoutDirection = useFableBuilderStore((s) => s.layoutDirection)
  const nodesLocked = useFableBuilderStore((s) => s.nodesLocked)
  const isMiniMapOpen = useFableBuilderStore((s) => s.isMiniMapOpen)

  const setEdgeStyle = useFableBuilderStore((s) => s.setEdgeStyle)
  const setAutoLayout = useFableBuilderStore((s) => s.setAutoLayout)
  const setLayoutDirection = useFableBuilderStore((s) => s.setLayoutDirection)
  const setNodesLocked = useFableBuilderStore((s) => s.setNodesLocked)
  const toggleMiniMap = useFableBuilderStore((s) => s.toggleMiniMap)
  const triggerFitView = useFableBuilderStore((s) => s.triggerFitView)
  const mode = useFableBuilderStore((s) => s.mode)
  const setMode = useFableBuilderStore((s) => s.setMode)

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
        {mode === 'graph' && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('graphOptions.view')}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  // Force layout recalculation by enabling auto-layout if needed
                  if (!autoLayout) {
                    setAutoLayout(true)
                  }
                  // Trigger fit view with a slight delay to allow layout to recalculate
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
              <DropdownMenuCheckboxItem
                checked={autoLayout}
                onCheckedChange={setAutoLayout}
              >
                <Workflow />
                {t('graphOptions.autoLayout')}
              </DropdownMenuCheckboxItem>

              {autoLayout && (
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
              )}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('graphOptions.edges')}</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t('graphOptions.style')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={edgeStyle}
                    onValueChange={(value) => setEdgeStyle(value as EdgeStyle)}
                  >
                    <DropdownMenuRadioItem value="bezier">
                      {t('graphOptions.curved')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="smoothstep">
                      {t('graphOptions.rounded')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="step">
                      {t('graphOptions.orthogonal')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => setMode(mode === 'graph' ? 'form' : 'graph')}
        >
          {mode === 'graph' ? <FileText /> : <LayoutGrid />}
          {mode === 'graph'
            ? t('graphOptions.switchToForm')
            : t('graphOptions.switchToGraph')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
