/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Precompute ancestor / descendant sets per task so hover-highlight is O(1).
 * Dangling parent refs (cross-slice edges) are dropped so BFS never visits
 * ghosts. */

import type { CompilationDetailTask } from '@/api/types/job.types'

export interface TaskLineage {
  ancestors: Map<string, Set<string>>
  descendants: Map<string, Set<string>>
}

function bfs(
  start: string,
  adjacency: Map<string, Array<string>>,
): Set<string> {
  const visited = new Set<string>()
  const queue: Array<string> = []
  const seeds = adjacency.get(start)
  if (seeds) queue.push(...seeds)
  while (queue.length > 0) {
    const next = queue.shift()!
    if (visited.has(next)) continue
    visited.add(next)
    const neighbours = adjacency.get(next)
    if (neighbours) queue.push(...neighbours)
  }
  return visited
}

export function buildLineage(
  tasks: ReadonlyArray<CompilationDetailTask>,
): TaskLineage {
  const taskIds = new Set(tasks.map((task) => task.task_id))

  const parentsOf = new Map<string, Array<string>>()
  const childrenOf = new Map<string, Array<string>>()

  for (const task of tasks) {
    // Drop parents outside the input set — see file header.
    const realParents = task.parents.filter((parent) => taskIds.has(parent))
    parentsOf.set(task.task_id, realParents)
    if (!childrenOf.has(task.task_id)) childrenOf.set(task.task_id, [])
    for (const parent of realParents) {
      const list = childrenOf.get(parent)
      if (list) list.push(task.task_id)
      else childrenOf.set(parent, [task.task_id])
    }
  }

  const ancestors = new Map<string, Set<string>>()
  const descendants = new Map<string, Set<string>>()
  for (const task of tasks) {
    ancestors.set(task.task_id, bfs(task.task_id, parentsOf))
    descendants.set(task.task_id, bfs(task.task_id, childrenOf))
  }
  return { ancestors, descendants }
}

/** Return the union of {task, its ancestors, its descendants}. */
export function lineageUnion(
  taskId: string,
  lineage: TaskLineage,
): Set<string> {
  const result = new Set<string>([taskId])
  lineage.ancestors.get(taskId)?.forEach((id) => result.add(id))
  lineage.descendants.get(taskId)?.forEach((id) => result.add(id))
  return result
}
