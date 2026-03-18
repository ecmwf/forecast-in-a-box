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
  Lock,
  LockOpen,
  Map,
  MoreHorizontal,
  Sparkles,
  Workflow,
} from 'lucide-react'
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="default"
            size="sm"
            className="h-8 w-8 p-0 shadow-sm"
            aria-label="Graph options"
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>View</DropdownMenuLabel>
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
            Tidy up configuration
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNodesLocked(!nodesLocked)}>
            {nodesLocked ? <Lock /> : <LockOpen />}
            {nodesLocked ? 'Unlock nodes' : 'Lock nodes'}
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={isMiniMapOpen}
            onCheckedChange={toggleMiniMap}
          >
            <Map />
            Show minimap
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={autoLayout}
            onCheckedChange={setAutoLayout}
          >
            <Workflow />
            Auto-layout
          </DropdownMenuCheckboxItem>

          {autoLayout && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Direction</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={layoutDirection}
                  onValueChange={(value) =>
                    setLayoutDirection(value as LayoutDirection)
                  }
                >
                  <DropdownMenuRadioItem value="TB">
                    ↓ Top to Bottom
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="LR">
                    → Left to Right
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Edges</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Style</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={edgeStyle}
                onValueChange={(value) => setEdgeStyle(value as EdgeStyle)}
              >
                <DropdownMenuRadioItem value="bezier">
                  Curved
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="smoothstep">
                  Rounded
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="step">
                  Orthogonal
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
