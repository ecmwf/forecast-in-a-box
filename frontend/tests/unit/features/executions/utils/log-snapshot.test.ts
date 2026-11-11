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
import { strToU8, zipSync } from 'fflate'
import type { ViewRequest } from '@/features/executions/utils/log-snapshot'
import { LogSnapshotStore } from '@/features/executions/utils/log-snapshot'
import { lineText } from '@/features/executions/utils/run-logs'

const JOB = 'job_3cb680a4'
const at = (s: number) => `2026-11-08 08:10:${String(s).padStart(2, '0')},000`
const lines = (n: number, level = 'INFO') =>
  Array.from({ length: n }, (_, i) => `${at(i)}:${level}:a:1:line ${i + 1}`)

const backendText = lines(30).join('\n') + '\n'
const archive = zipSync({
  [`${JOB}.controller.logs.txt`]: strToU8(
    [...lines(3), `${at(4)}:ERROR:a:1:boom`].join('\n'),
  ),
  'backend.logs.txt': strToU8(backendText),
  'lens.1.logs.txt': strToU8(lines(5).join('\n')),
  'logs_directory.error.txt': strToU8('no logs directory'),
})

const request = (overrides: Partial<ViewRequest> = {}): ViewRequest => ({
  file: null,
  query: '',
  minLevel: null,
  window: null,
  content: false,
  sectionLimit: 200,
  ...overrides,
})

/** Every file read. */
function loaded() {
  const store = new LogSnapshotStore()
  const summary = store.load(archive)
  return { store, summary }
}

describe('LogSnapshotStore.load', () => {
  // Controller 158 bytes, then a 300-byte backend tail; 55 bytes are left.
  const budget = { fileBytes: 300, totalBytes: 500 }

  it('reads a large file from its tail and numbers lines in the whole file', () => {
    const store = new LogSnapshotStore()
    const backend = store
      .load(archive, budget)
      .files.find((f) => f.label === 'backend')
    expect(backend).toMatchObject({ totalLines: 30, bytes: backendText.length })
    expect(backend?.readBytes).toBeLessThanOrEqual(300)
    const view = store.view(
      request({ file: 'backend.logs.txt', content: true }),
    )
    const read = view.content?.starts.length ?? 0
    expect(backend?.firstNumber).toBe(30 - read + 1)
    expect(view.content && lineText(view.content, read - 1)).toContain(
      'line 30',
    )
  })

  it('leaves files past the total budget unread', () => {
    const summary = new LogSnapshotStore().load(archive, budget)
    expect(summary.files.map((f) => f.label)).toEqual([
      'controller',
      'backend',
      'logs_directory.error',
    ])
    expect(summary.unread.map((f) => f.label)).toEqual(['lens.1'])
  })

  it('passes on the server note when it could not collect the logs', () => {
    expect(loaded().summary.collectError).toBe('no logs directory')
  })
})

describe('LogSnapshotStore.view', () => {
  it('returns one file with its lines once, and the first error', () => {
    const { store } = loaded()
    const name = `${JOB}.controller.logs.txt`
    const view = store.view(request({ file: name, content: true }))
    expect(Array.from(view.indices ?? [])).toEqual([0, 1, 2, 3])
    expect(view.content && lineText(view.content, 3)).toContain('boom')
    expect(view.firstError).toEqual({ file: name, line: 4 })
    expect(store.view(request({ file: name })).content).toBeUndefined()
  })

  it('counts matches per file and keeps the last of each in sections', () => {
    const { store } = loaded()
    const view = store.view(request({ query: 'line 2', sectionLimit: 2 }))
    // Lines 2 and 20 to 29.
    expect(view.perFile['backend.logs.txt'].matches).toBe(11)
    const backend = view.sections?.find((s) => s.name === 'backend.logs.txt')
    expect(backend?.rows.map((r) => r.number)).toEqual([28, 29])
    const lens = view.sections?.find((s) => s.name === 'lens.1.logs.txt')
    expect(lens?.rows.map((r) => r.number)).toEqual([2])
  })

  it('applies the run window to server-wide files only', () => {
    const { store } = loaded()
    const window = {
      from: Date.UTC(2026, 10, 8, 8, 10, 0),
      to: Date.UTC(2026, 10, 8, 8, 10, 1),
    }
    const view = store.view(request({ window }))
    expect(view.perFile['lens.1.logs.txt'].scoped).toBe(2)
    expect(view.perFile[`${JOB}.controller.logs.txt`].scoped).toBe(4)
  })
})

describe('LogSnapshotStore.fileBytes', () => {
  it('inflates the whole file again, past the budget', () => {
    const { store } = loaded()
    const bytes = store.fileBytes('backend.logs.txt')
    expect(new TextDecoder().decode(bytes).split('\n')).toHaveLength(31)
  })
})
