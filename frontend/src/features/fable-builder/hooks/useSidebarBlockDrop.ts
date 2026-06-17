/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BlockFactory,
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { DraggedFactory } from '@/features/fable-builder/stores/fableBuilderStore'
import { getFactory } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

// Slack (px) around a 20px connection handle so it is an easy drop target.
const HANDLE_PADDING = 20
const ACTIVE_CLASS = 'dnd-active'
// Branch drops glow a distinct colour from insert/connect (see styles.css).
const BRANCH_CLASS = 'dnd-active-branch'

/** A concrete connection a drop would create against an existing node. */
export interface DropConnection {
  nodeId: string
  /** The existing node's handle that gets wired. */
  handleId: string
  /** True if `handleId` is an input (target) handle; false for the output. */
  isInput: boolean
  /** That handle's DOM element, for the hover highlight (may be null). */
  handleEl: Element | null
}

/** What a drop will do — drives the hover signal and the wiring. branch: fork
 *  off a source's output · insert: slice into an existing edge (source → new →
 *  target) · connect: a plain new wire. */
export type DropMode = 'branch' | 'insert' | 'connect'

/** Classify what dropping on `conn` will do, for the hover signal. */
export function dropModeForConnection(
  conn: DropConnection,
  fable: FableBuilderV1,
): DropMode {
  if (conn.isInput) {
    const prior = fable.blocks[conn.nodeId].input_ids[conn.handleId] as
      | string
      | undefined
    return prior ? 'insert' : 'connect'
  }
  const sourceHasConsumers = Object.values(fable.blocks).some((block) =>
    Object.values(block.input_ids).includes(conn.nodeId),
  )
  return sourceHasConsumers ? 'branch' : 'connect'
}

/** Rewires for splicing a block in: `downstream` = prior consumers of the source
 *  (output drop); `priorParent` = the input's prior parent (input drop). Drag
 *  drops branch on output, so the hook only uses `priorParent`. */
export function computeSpliceContext(
  conn: DropConnection,
  factory: BlockFactory,
  fable: FableBuilderV1,
): {
  downstream: Array<{ id: string; inputName: string }>
  priorParent: string | null
} {
  const downstream: Array<{ id: string; inputName: string }> = []
  let priorParent: string | null = null
  if (!conn.isInput && factory.kind !== 'sink' && factory.inputs.length > 0) {
    for (const [id, block] of Object.entries(fable.blocks)) {
      for (const [inputName, parentId] of Object.entries(block.input_ids)) {
        if (parentId === conn.nodeId) downstream.push({ id, inputName })
      }
    }
  } else if (conn.isInput && factory.inputs.length > 0) {
    const block = fable.blocks[conn.nodeId]
    const raw = block.input_ids[conn.handleId] as string | undefined
    priorParent = raw ?? null
  }
  return { downstream, priorParent }
}

/** Whether a dragged factory fits a handle: an input handle needs it to have
 *  an output, an output handle needs it to have inputs. */
function canConnect(factory: BlockFactory, toInput: boolean): boolean {
  return toInput ? factory.kind !== 'sink' : factory.inputs.length > 0
}

/** Builds a connection from a handle element, if the dragged block fits it. */
function connectionForHandle(
  el: Element,
  dragged: DraggedFactory,
): DropConnection | null {
  const nodeId = el.getAttribute('data-nodeid')
  const handleId = el.getAttribute('data-handleid')
  if (!nodeId || !handleId) return null
  // React Flow tags target (input) handles with the `target` class.
  const isInput = el.classList.contains('target')
  if (!canConnect(dragged.factory, isInput)) return null
  return { nodeId, handleId, isInput, handleEl: el }
}

/** How a drop on a node body connects: prefer the new block consuming the
 *  node's output, else feeding its first input. */
function connectionForNode(
  nodeId: string,
  dragged: DraggedFactory,
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
  handles: Array<HTMLElement>,
): DropConnection | null {
  const nodeFactory = getFactory(catalogue, fable.blocks[nodeId].factory_id)
  if (!nodeFactory) return null

  const findHandle = (handleId: string): Element | null =>
    handles.find(
      (h) =>
        h.getAttribute('data-nodeid') === nodeId &&
        h.getAttribute('data-handleid') === handleId,
    ) ?? null

  // New block consumes the node's output.
  if (nodeFactory.kind !== 'sink' && dragged.factory.inputs.length > 0) {
    return {
      nodeId,
      handleId: 'output',
      isInput: false,
      handleEl: findHandle('output'),
    }
  }
  // New block feeds the node's first input.
  if (dragged.factory.kind !== 'sink' && nodeFactory.inputs.length > 0) {
    const handleId = nodeFactory.inputs[0]
    return { nodeId, handleId, isInput: true, handleEl: findHandle(handleId) }
  }
  return null
}

/** The connection a drop at the given point would make. Matches handles by
 *  geometry (not `elementFromPoint`); a drop anywhere on a node still connects. */
function resolveDrop(
  x: number,
  y: number,
  dragged: DraggedFactory,
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): DropConnection | null {
  const handles = Array.from(
    document.querySelectorAll<HTMLElement>('.react-flow__handle'),
  )

  // Nearest handle whose padded box covers the point.
  let nearest: { el: HTMLElement; dist: number } | null = null
  for (const el of handles) {
    const r = el.getBoundingClientRect()
    if (
      x < r.left - HANDLE_PADDING ||
      x > r.right + HANDLE_PADDING ||
      y < r.top - HANDLE_PADDING ||
      y > r.bottom + HANDLE_PADDING
    ) {
      continue
    }
    const dist = Math.hypot(
      x - (r.left + r.width / 2),
      y - (r.top + r.height / 2),
    )
    if (!nearest || dist < nearest.dist) nearest = { el, dist }
  }
  if (nearest) {
    const conn = connectionForHandle(nearest.el, dragged)
    if (conn) return conn
  }

  // Otherwise, a drop anywhere on a node's body still connects.
  const nodeEl = document.elementFromPoint(x, y)?.closest('.react-flow__node')
  const nodeId = nodeEl
    ?.querySelector('.react-flow__handle')
    ?.getAttribute('data-nodeid')
  if (nodeId) {
    return connectionForNode(nodeId, dragged, fable, catalogue, handles)
  }
  return null
}

/** Drop handlers for the graph pane. Wiring by drop target: target input →
 *  slice & insert (source → new → target); source output / node body → branch.
 *  `dropMode` mirrors this for the hover signal. */
export function useSidebarBlockDrop(catalogue: BlockFactoryCatalogue) {
  const draggedFactory = useFableBuilderStore((s) => s.draggedFactory)
  const fable = useFableBuilderStore((s) => s.fable)
  const addBlock = useFableBuilderStore((s) => s.addBlock)
  const connectBlocks = useFableBuilderStore((s) => s.connectBlocks)
  const setDraggedFactory = useFableBuilderStore((s) => s.setDraggedFactory)
  const beginHistoryTransaction = useFableBuilderStore(
    (s) => s.beginHistoryTransaction,
  )
  const endHistoryTransaction = useFableBuilderStore(
    (s) => s.endHistoryTransaction,
  )
  const activeHandleRef = useRef<Element | null>(null)
  const [dropMode, setDropMode] = useState<DropMode | null>(null)

  const clearActiveHandle = useCallback(() => {
    activeHandleRef.current?.classList.remove(ACTIVE_CLASS, BRANCH_CLASS)
    activeHandleRef.current = null
  }, [])

  // Clear the hover highlight + signal when a drag ends (covers off-canvas).
  useEffect(() => {
    if (!draggedFactory) {
      clearActiveHandle()
      setDropMode(null)
    }
  }, [draggedFactory, clearActiveHandle])

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!draggedFactory) return
      // Required for the pane to accept the drop.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'

      const conn = resolveDrop(
        e.clientX,
        e.clientY,
        draggedFactory,
        fable,
        catalogue,
      )
      const activeEl = conn?.handleEl ?? null
      if (activeEl === activeHandleRef.current) return
      clearActiveHandle()
      if (conn && activeEl) {
        const mode = dropModeForConnection(conn, fable)
        activeEl.classList.add(ACTIVE_CLASS)
        if (mode === 'branch') activeEl.classList.add(BRANCH_CLASS)
        activeHandleRef.current = activeEl
        setDropMode(mode)
      } else {
        setDropMode(null)
      }
    },
    [draggedFactory, fable, catalogue, clearActiveHandle],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!draggedFactory) return
      e.preventDefault()
      clearActiveHandle()
      setDropMode(null)

      const conn = resolveDrop(
        e.clientX,
        e.clientY,
        draggedFactory,
        fable,
        catalogue,
      )
      const dragged = draggedFactory
      // Only input drops splice; branch drops need no extra rewire.
      const priorParent = conn?.isInput
        ? computeSpliceContext(conn, dragged.factory, fable).priorParent
        : null

      // Group add + connect + splice rewires into a single undo step.
      beginHistoryTransaction()
      try {
        const newId = addBlock(dragged.id, dragged.factory)

        if (conn) {
          if (conn.isInput) {
            // Slice: source → new → target (reparent the input's prior source).
            connectBlocks(conn.nodeId, conn.handleId, newId)
            if (priorParent) {
              connectBlocks(newId, dragged.factory.inputs[0], priorParent)
            }
          } else {
            // Branch: new consumes the source; its other consumers stay wired.
            connectBlocks(newId, dragged.factory.inputs[0], conn.nodeId)
          }
        }
      } finally {
        endHistoryTransaction()
      }

      setDraggedFactory(null)
    },
    [
      draggedFactory,
      fable,
      catalogue,
      addBlock,
      connectBlocks,
      beginHistoryTransaction,
      endHistoryTransaction,
      setDraggedFactory,
      clearActiveHandle,
    ],
  )

  return { onDragOver, onDrop, dropMode }
}
