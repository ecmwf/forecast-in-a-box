/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { create } from 'zustand'

interface ExecutionHoverState {
  hoveredBlockId: string | null
  setHoveredBlockId: (id: string | null) => void
  /** Cross-panel selection shared between the left RunCanvas and the right
   * tabs (Outputs, Compilation, Graph). `null` = nothing selected. */
  selectedBlockId: string | null
  setSelectedBlockId: (id: string | null) => void
  /** Sink blocks on sides A and B of the output comparison; null without one. */
  compareSides: Record<'a' | 'b', string> | null
  setCompareSides: (sides: Record<'a' | 'b', string> | null) => void
  /** The compare row is in use, so the graph shows the sides. */
  compareSidesShown: boolean
  setCompareSidesShown: (shown: boolean) => void
  /** Clears hover and selection on run change; the compare sides belong to the card that sets them. */
  resetExecutionSelection: () => void
}

export const useExecutionHoverStore = create<ExecutionHoverState>(
  (set, get) => ({
    hoveredBlockId: null,
    setHoveredBlockId: (id) => {
      if (get().hoveredBlockId === id) return
      set({ hoveredBlockId: id })
    },
    selectedBlockId: null,
    setSelectedBlockId: (id) => {
      if (get().selectedBlockId === id) return
      set({ selectedBlockId: id })
    },
    compareSides: null,
    setCompareSides: (sides) => {
      const current = get().compareSides
      if (current?.a === sides?.a && current?.b === sides?.b) return
      set({ compareSides: sides })
    },
    compareSidesShown: false,
    setCompareSidesShown: (shown) => {
      if (get().compareSidesShown === shown) return
      set({ compareSidesShown: shown })
    },
    resetExecutionSelection: () => {
      set({ hoveredBlockId: null, selectedBlockId: null })
    },
  }),
)

/** True when this block id is the currently-hovered one. */
export function useIsBlockHovered(blockId: string): boolean {
  return useExecutionHoverStore((state) => state.hoveredBlockId === blockId)
}

/** Side of the output comparison a block is on, if any. */
export function useBlockCompareSide(blockId: string): 'a' | 'b' | null {
  return useExecutionHoverStore((state) =>
    state.compareSides?.a === blockId
      ? 'a'
      : state.compareSides?.b === blockId
        ? 'b'
        : null,
  )
}

/** True while the compare row is in use. */
export function useCompareSidesShown(): boolean {
  return useExecutionHoverStore((state) => state.compareSidesShown)
}

/** True when this block id is the currently-selected one. */
export function useIsBlockSelected(blockId: string): boolean {
  return useExecutionHoverStore((state) => state.selectedBlockId === blockId)
}

/** Stable enter/leave handlers that set `blockId` on enter and clear on leave.
 * Returns `undefined` for both when `blockId` is null, so spreading on an
 * element attaches no listeners. */
export function useBlockHoverHandlers(blockId: string | null): {
  onPointerEnter?: () => void
  onPointerLeave?: () => void
} {
  const setHoveredBlockId = useExecutionHoverStore(
    (state) => state.setHoveredBlockId,
  )
  if (blockId === null) return {}
  return {
    onPointerEnter: () => setHoveredBlockId(blockId),
    onPointerLeave: () => setHoveredBlockId(null),
  }
}
