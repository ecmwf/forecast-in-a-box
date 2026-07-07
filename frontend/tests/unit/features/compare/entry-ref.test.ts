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
import {
  decodeEntryRef,
  entryDisplayName,
  entryRef,
} from '@/features/compare/entry-ref'

const outputEntry = {
  kind: 'output' as const,
  jobId: '4808b259-cd35-44a7-a203-94471659fc2f',
  taskId: 'task_out-1.2',
  blockId: 'block_sink_1',
  runName: 'Anemoi Model Source',
  blockTitle: 'GRIB Sink',
  runCreatedAt: null,
}

describe('entryRef / decodeEntryRef', () => {
  it('round-trips output refs with ids containing - _ .', () => {
    const ref = entryRef(outputEntry)
    expect(ref).toBe(`run:${outputEntry.jobId}~${outputEntry.taskId}`)
    expect(decodeEntryRef(ref)).toEqual({
      kind: 'output',
      jobId: outputEntry.jobId,
      taskId: outputEntry.taskId,
    })
  })

  it('round-trips path and wms refs', () => {
    const path = '/Users/x/.fiab/jobs_output/4af24cc6_1'
    expect(
      decodeEntryRef(entryRef({ kind: 'path', path, label: 'x' })),
    ).toEqual({ kind: 'path', path })
    const url = 'http://localhost:19001'
    expect(decodeEntryRef(entryRef({ kind: 'wms', url, label: 'x' }))).toEqual({
      kind: 'wms',
      url,
    })
  })

  it('rejects malformed refs', () => {
    expect(decodeEntryRef('run:no-separator')).toBeNull()
    expect(decodeEntryRef('run:~task-only')).toBeNull()
    expect(decodeEntryRef('run:job-only~')).toBeNull()
    expect(decodeEntryRef('path:')).toBeNull()
    expect(decodeEntryRef('wms:')).toBeNull()
    expect(decodeEntryRef('bogus:x')).toBeNull()
    expect(decodeEntryRef('')).toBeNull()
  })

  it('derives display names per kind', () => {
    expect(entryDisplayName(outputEntry)).toBe('Anemoi Model Source')
    expect(entryDisplayName({ ...outputEntry, runName: '' })).toBe('GRIB Sink')
    expect(
      entryDisplayName({ ...outputEntry, runName: '', blockTitle: '' }),
    ).toBe('4808b259')
    expect(
      entryDisplayName({ kind: 'path', path: '/p', label: 'My data' }),
    ).toBe('My data')
  })
})
