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
}

export const useExecutionHoverStore = create<ExecutionHoverState>(
  (set, get) => ({
    hoveredBlockId: null,
    setHoveredBlockId: (id) => {
      if (get().hoveredBlockId === id) return
      set({ hoveredBlockId: id })
    },
  }),
)

/** True when this block id is the currently-hovered one. */
export function useIsBlockHovered(blockId: string): boolean {
  return useExecutionHoverStore((state) => state.hoveredBlockId === blockId)
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
