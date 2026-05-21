/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import type { CompilationDetailTask } from '@/api/types/job.types'
import {
  COMPILATION_BLOCK_NODE_TYPE,
  buildFullTaskGraph,
} from '@/features/executions/utils/taskDagLayout'

function task(
  id: string,
  block: string,
  parents: ReadonlyArray<string>,
): CompilationDetailTask {
  return { task_id: id, block, display_name: id, parents: [...parents] }
}

const TASKS: ReadonlyArray<CompilationDetailTask> = [
  task('src1', 'block_a', []),
  task('src2', 'block_a', ['src1']),
  task('sink1', 'block_b', ['src2']),
]

describe('buildFullTaskGraph', () => {
  it('emits one group node per block plus all task nodes', () => {
    const { nodes } = buildFullTaskGraph(TASKS, (id) => `Block ${id}`)
    const groups = nodes.filter((n) => n.type === COMPILATION_BLOCK_NODE_TYPE)
    const taskNodes = nodes.filter((n) => n.type === 'compilationTask')
    expect(groups.map((g) => g.id).sort()).toEqual([
      'group:block_a',
      'group:block_b',
    ])
    expect(taskNodes.map((n) => n.id).sort()).toEqual(['sink1', 'src1', 'src2'])
  })

  it('resolves block labels via the provided callback', () => {
    const { nodes } = buildFullTaskGraph(TASKS, (id) =>
      id === 'block_a' ? 'Anemoi Source' : 'Map Plot',
    )
    const labels = nodes
      .filter((n) => n.type === COMPILATION_BLOCK_NODE_TYPE)
      .map((n) => (n.data as { label: string }).label)
      .sort()
    expect(labels).toEqual(['Anemoi Source', 'Map Plot'])
  })

  it('marks cross-block edges and leaves intra-block edges undecorated', () => {
    const { edges } = buildFullTaskGraph(TASKS, () => 'B')
    const byKey = new Map(edges.map((e) => [`${e.source}->${e.target}`, e]))
    // src1 → src2 stays within block_a.
    expect(
      (byKey.get('src1->src2')!.data as { crossBlock: boolean }).crossBlock,
    ).toBe(false)
    // src2 → sink1 crosses from block_a to block_b.
    expect(
      (byKey.get('src2->sink1')!.data as { crossBlock: boolean }).crossBlock,
    ).toBe(true)
    // Cross-block edges get a dashed style.
    expect(byKey.get('src2->sink1')!.style?.strokeDasharray).toBeDefined()
    expect(byKey.get('src1->src2')!.style).toBeUndefined()
  })

  it('places group nodes before task nodes so they render behind', () => {
    const { nodes } = buildFullTaskGraph(TASKS, () => 'B')
    const firstTaskIdx = nodes.findIndex((n) => n.type === 'compilationTask')
    // Scan from the end so we don't need findLastIndex (avoids needing
    // a newer TS lib target).
    let lastGroupIdx = -1
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].type === COMPILATION_BLOCK_NODE_TYPE) {
        lastGroupIdx = i
        break
      }
    }
    expect(lastGroupIdx).toBeLessThan(firstTaskIdx)
  })

  it('sets group dimensions and a negative zIndex', () => {
    const { nodes } = buildFullTaskGraph(TASKS, () => 'B')
    const group = nodes.find((n) => n.type === COMPILATION_BLOCK_NODE_TYPE)!
    expect(group.zIndex).toBe(-1)
    const style = group.style as { width: number; height: number }
    expect(style.width).toBeGreaterThan(0)
    expect(style.height).toBeGreaterThan(0)
  })
})
