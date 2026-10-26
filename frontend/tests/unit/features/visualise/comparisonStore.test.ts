/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { OutputComparisonEntry } from '@/features/visualise/entry-ref'
import { entryRef } from '@/features/visualise/entry-ref'
import {
  MAX_COMPARISON_ENTRIES,
  useComparisonStore,
} from '@/features/visualise/stores/comparisonStore'

function outputEntry(n: number): Omit<OutputComparisonEntry, 'addedAt'> {
  return {
    kind: 'output',
    jobId: `job-${n}`,
    taskId: `task-${n}`,
    blockId: `block-${n}`,
    runName: `Run ${n}`,
    blockTitle: 'GRIB Sink',
    runCreatedAt: null,
  }
}

const store = () => useComparisonStore.getState()

beforeEach(() => {
  useComparisonStore.setState({ entries: [] })
})

describe('comparisonStore', () => {
  it('adds entries, stamps addedAt, and dedupes by ref', () => {
    expect(store().addEntry(outputEntry(1))).toMatchObject({ status: 'added' })
    expect(store().addEntry(outputEntry(1))).toMatchObject({
      status: 'duplicate',
    })
    expect(store().entries).toHaveLength(1)
    expect(store().entries[0].addedAt).toBeGreaterThan(0)
  })

  it('makes room by dropping the oldest entry not kept', () => {
    for (let i = 0; i < MAX_COMPARISON_ENTRIES; i++) {
      store().addEntry(outputEntry(i))
    }
    const keep = entryRef(store().entries[0])
    const outcome = store().addEntry(outputEntry(99), [keep])
    expect(outcome.status).toBe('added')
    expect(outcome.evicted.map(entryRef)).toEqual([entryRef(outputEntry(1))])
    expect(store().entries).toHaveLength(MAX_COMPARISON_ENTRIES)
    expect(store().entries.map(entryRef)).toContain(keep)
    expect(store().addEntry(outputEntry(99)).status).toBe('duplicate')
  })

  it('removes by ref and clears', () => {
    store().addEntry(outputEntry(1))
    store().addEntry(outputEntry(2))
    store().removeEntry(entryRef(outputEntry(1)))
    expect(store().entries.map((e) => entryRef(e))).toEqual([
      entryRef(outputEntry(2)),
    ])
    store().clear()
    expect(store().entries).toHaveLength(0)
  })

  it('updates output metadata in place, only for output entries', () => {
    store().addEntry({ ...outputEntry(1), runName: '' })
    store().addEntry({ kind: 'path', path: '/p', label: 'P' })
    const ref = entryRef(outputEntry(1))

    store().updateOutputMeta(ref, {
      runName: 'Enriched',
      runCreatedAt: '2026-07-06T00:00:00Z',
    })
    const updated = store().entries[0]
    expect(updated.kind === 'output' && updated.runName).toBe('Enriched')

    // Path entries are untouched by output-meta updates.
    store().updateOutputMeta(
      entryRef({ kind: 'path', path: '/p', label: 'P' }),
      { runName: 'nope' },
    )
    const pathEntry = store().entries[1]
    expect(pathEntry.kind).toBe('path')
    expect('runName' in pathEntry).toBe(false)
  })

  it('renames path/wms entries but never output entries', () => {
    store().addEntry({ kind: 'wms', url: 'http://x', label: 'old' })
    store().renameEntry('wms:http://x', 'new')
    const wms = store().entries[0]
    expect(wms.kind === 'wms' && wms.label).toBe('new')

    store().addEntry(outputEntry(1))
    store().renameEntry(entryRef(outputEntry(1)), 'nope')
    const output = store().entries[1]
    expect(output.kind).toBe('output')
    expect('label' in output).toBe(false)
  })
})
