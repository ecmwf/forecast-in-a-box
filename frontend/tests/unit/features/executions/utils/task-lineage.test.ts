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
  buildLineage,
  lineageUnion,
} from '@/features/executions/utils/taskLineage'

function task(
  id: string,
  parents: ReadonlyArray<string>,
): CompilationDetailTask {
  return { task_id: id, block: 'b', display_name: id, parents: [...parents] }
}

// Linear chain a → b → c, plus a sibling branch c1 from b.
const TASKS: ReadonlyArray<CompilationDetailTask> = [
  task('a', []),
  task('b', ['a']),
  task('c', ['b']),
  task('c1', ['b']),
]

describe('buildLineage', () => {
  it('returns ancestors transitively', () => {
    const lineage = buildLineage(TASKS)
    expect([...lineage.ancestors.get('c')!].sort()).toEqual(['a', 'b'])
    expect([...lineage.ancestors.get('c1')!].sort()).toEqual(['a', 'b'])
    expect(lineage.ancestors.get('a')!.size).toBe(0)
  })

  it('returns descendants transitively', () => {
    const lineage = buildLineage(TASKS)
    expect([...lineage.descendants.get('a')!].sort()).toEqual(['b', 'c', 'c1'])
    expect(lineage.descendants.get('c')!.size).toBe(0)
  })

  it('drops dangling parent references (cross-slice edges)', () => {
    const sliced = [task('only', ['missing-parent'])]
    const lineage = buildLineage(sliced)
    expect(lineage.ancestors.get('only')!.size).toBe(0)
  })
})

describe('lineageUnion', () => {
  it('includes the focus task plus its full lineage', () => {
    const lineage = buildLineage(TASKS)
    const union = lineageUnion('b', lineage)
    expect([...union].sort()).toEqual(['a', 'b', 'c', 'c1'])
  })
})
