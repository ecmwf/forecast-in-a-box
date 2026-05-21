/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Dagre LR layout for the compilation task DAG (drawer + full-graph tab).
 * Tuned for the compact task nodes; same pattern as `layout-blocks.ts`. */

import Dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { CompilationDetailTask } from '@/api/types/job.types'

export interface TaskNodeData extends Record<string, unknown> {
  task: CompilationDetailTask
  /** Topological index inside the laid-out DAG; used for staggered reveal. */
  revealIndex: number
}

const NODE_WIDTH = 200
const NODE_HEIGHT = 64
const NODE_SPACING_Y = 24
const NODE_SPACING_X = 64
const NODE_TYPE = 'compilationTask'
const EDGE_TYPE = 'default'

export interface LaidOutTaskGraph {
  nodes: Array<Node<TaskNodeData>>
  edges: Array<Edge>
}

export function buildTaskGraph(
  tasks: ReadonlyArray<CompilationDetailTask>,
): LaidOutTaskGraph {
  const taskIds = new Set(tasks.map((task) => task.task_id))
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))

  g.setGraph({
    rankdir: 'LR',
    nodesep: NODE_SPACING_Y,
    ranksep: NODE_SPACING_X,
    marginx: 16,
    marginy: 16,
    ranker: 'network-simplex',
  })

  for (const task of tasks) {
    g.setNode(task.task_id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const edges: Array<Edge> = []
  for (const task of tasks) {
    for (const parent of task.parents) {
      // Skip cross-slice parents (filtered by block_id) — Dagre would crash
      // on edges that reference nodes outside the input set.
      if (!taskIds.has(parent)) continue
      g.setEdge(parent, task.task_id)
      edges.push({
        id: `${parent}->${task.task_id}`,
        source: parent,
        target: task.task_id,
        type: EDGE_TYPE,
      })
    }
  }

  Dagre.layout(g)

  // Order by x then y so the reveal animation walks the DAG root-first.
  const ordered = [...tasks]
    .map((task) => ({ task, node: g.node(task.task_id) }))
    .sort((a, b) => a.node.x - b.node.x || a.node.y - b.node.y)

  const nodes: Array<Node<TaskNodeData>> = ordered.map(
    ({ task, node }, index) => ({
      id: task.task_id,
      type: NODE_TYPE,
      position: {
        x: node.x - NODE_WIDTH / 2,
        y: node.y - NODE_HEIGHT / 2,
      },
      data: { task, revealIndex: index },
      draggable: false,
      selectable: true,
    }),
  )

  return { nodes, edges }
}

export const TASK_NODE_WIDTH = NODE_WIDTH
export const TASK_NODE_HEIGHT = NODE_HEIGHT

// ---------------------------------------------------------------------------
// Full-graph layout (Compilation tab) — task DAG + per-block swimlanes
// ---------------------------------------------------------------------------

export interface BlockGroupData extends Record<string, unknown> {
  blockId: string
  label: string
  taskCount: number
}

export const COMPILATION_BLOCK_NODE_TYPE = 'compilationBlock'
/** Inner padding around tasks inside a block swimlane. Top is taller to
 * reserve space for the block-label header. */
const GROUP_PAD_X = 14
const GROUP_PAD_TOP = 30
const GROUP_PAD_BOTTOM = 12

export interface LaidOutFullTaskGraph {
  /** Group nodes come first so they render behind tasks (ReactFlow honours
   * array order when zIndex is the same, and we also set zIndex=-1). */
  nodes: Array<Node<TaskNodeData | BlockGroupData>>
  edges: Array<Edge>
}

/** Lay out the full task DAG and emit a swimlane group node behind each
 * block's cluster. Cross-block edges are flagged via `data.crossBlock` and
 * stroked dashed so data flow between user blocks reads at a glance. */
export function buildFullTaskGraph(
  tasks: ReadonlyArray<CompilationDetailTask>,
  resolveBlockLabel: (blockId: string) => string,
): LaidOutFullTaskGraph {
  const base = buildTaskGraph(tasks)

  // Group laid-out task nodes by their owning block.
  const tasksByBlock = new Map<string, Array<Node<TaskNodeData>>>()
  for (const node of base.nodes) {
    const blockId = node.data.task.block
    const list = tasksByBlock.get(blockId)
    if (list) list.push(node)
    else tasksByBlock.set(blockId, [node])
  }

  // Compute bounding box per block and emit a group node behind the cluster.
  const groupNodes: Array<Node<BlockGroupData>> = []
  for (const [blockId, blockTasks] of tasksByBlock) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of blockTasks) {
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + NODE_WIDTH)
      maxY = Math.max(maxY, node.position.y + NODE_HEIGHT)
    }
    groupNodes.push({
      id: `group:${blockId}`,
      type: COMPILATION_BLOCK_NODE_TYPE,
      position: { x: minX - GROUP_PAD_X, y: minY - GROUP_PAD_TOP },
      data: {
        blockId,
        label: resolveBlockLabel(blockId),
        taskCount: blockTasks.length,
      },
      style: {
        width: maxX - minX + 2 * GROUP_PAD_X,
        height: maxY - minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
      },
      zIndex: -1,
      selectable: false,
      draggable: false,
      // pointer-events:none on the group is set by CompilationBlockNode's
      // CSS so the task nodes layered on top stay clickable.
    })
  }

  // Flag cross-block edges so the renderer can dash them.
  const blockByTaskId = new Map(tasks.map((task) => [task.task_id, task.block]))
  const edges = base.edges.map((edge) => {
    const sourceBlock = blockByTaskId.get(edge.source)
    const targetBlock = blockByTaskId.get(edge.target)
    const crossBlock =
      !!sourceBlock && !!targetBlock && sourceBlock !== targetBlock
    return {
      ...edge,
      data: { ...(edge.data ?? {}), crossBlock },
      style: crossBlock
        ? { strokeDasharray: '5 4', strokeWidth: 1.5 }
        : undefined,
      animated: false,
    }
  })

  return { nodes: [...groupNodes, ...base.nodes], edges }
}
