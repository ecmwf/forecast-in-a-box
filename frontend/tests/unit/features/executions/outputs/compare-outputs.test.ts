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
import type { ComparableOutput } from '@/features/executions/outputs/compare-outputs'
import {
  comparePairState,
  defaultPair,
  folderName,
  outputLabels,
  pickBlocker,
  pickSlot,
  sharedFolderBlockIds,
} from '@/features/executions/outputs/compare-outputs'

function output(
  blockId: string,
  dirPath: string | null,
  overrides: Partial<ComparableOutput> = {},
): ComparableOutput {
  return {
    blockId,
    taskId: `task-${blockId}`,
    title: 'GRIB Sink',
    written: true,
    lost: false,
    dirPath,
    ...overrides,
  }
}

describe('comparePairState', () => {
  it('is ready for two written outputs in separate folders', () => {
    expect(
      comparePairState(
        output('a', '/out/run/AIFS'),
        output('b', '/out/run/IFS'),
      ),
    ).toBe('ready')
  })

  it('refuses two outputs in the same folder, ignoring a trailing slash', () => {
    expect(
      comparePairState(output('a', '/out/run'), output('b', '/out/run/')),
    ).toBe('sharedFolder')
  })

  it('waits while an output is being written or its folder is unknown', () => {
    const ready = output('a', '/out/run/AIFS')
    expect(
      comparePairState(ready, output('b', '/out/run/IFS', { written: false })),
    ).toBe('writing')
    expect(comparePairState(ready, output('b', null))).toBe('writing')
  })

  it('reports a lost output before anything else', () => {
    expect(
      comparePairState(
        output('a', '/out/run'),
        output('b', '/out/run', { lost: true }),
      ),
    ).toBe('lost')
  })
})

describe('sharedFolderBlockIds', () => {
  it('names only the sinks that share a folder', () => {
    const shared = sharedFolderBlockIds([
      output('a', '/out/run'),
      output('b', '/out/run/'),
      output('c', '/out/run/IFS'),
      output('d', null),
    ])
    expect([...shared].sort()).toEqual(['a', 'b'])
  })
})

describe('outputLabels', () => {
  it('uses folder names once they tell the outputs apart', () => {
    expect(
      outputLabels([
        output('a', '/out/run/AIFS'),
        output('b', '/out/run/IFS/'),
      ]),
    ).toEqual({ a: 'AIFS', b: 'IFS' })
  })

  it('falls back to sink titles for equal or unresolved folders', () => {
    expect(
      outputLabels([output('a', '/out/run'), output('b', '/out/run')]),
    ).toEqual({ a: 'GRIB Sink', b: 'GRIB Sink' })
    expect(
      outputLabels([output('a', '/out/run/AIFS'), output('b', null)]),
    ).toEqual({ a: 'GRIB Sink', b: 'GRIB Sink' })
  })

  it('names the outputs whose folder is unique', () => {
    expect(
      outputLabels([
        output('a', '/out/run/AIFS'),
        output('b', '/out/run/AIFS'),
        output('c', '/out/run/IFS'),
        output('d', null, { lost: true }),
      ]),
    ).toEqual({ a: 'GRIB Sink', b: 'GRIB Sink', c: 'IFS', d: 'GRIB Sink' })
  })

  it('keeps the sink title for a single output', () => {
    expect(outputLabels([output('a', '/out/run_1')])).toEqual({
      a: 'GRIB Sink',
    })
  })
})

describe('pickSlot', () => {
  it('puts an output on a side', () => {
    expect(pickSlot({ a: 'x', b: 'y' }, 'b', 'z')).toEqual({ a: 'x', b: 'z' })
  })

  it('swaps when the output is on the other side', () => {
    expect(pickSlot({ a: 'x', b: 'y' }, 'a', 'y')).toEqual({ a: 'y', b: 'x' })
  })
})

describe('defaultPair', () => {
  it('needs two outputs', () => {
    expect(defaultPair([output('a', '/out/run/AIFS')])).toBeNull()
  })

  it('takes the first two outputs when they can be compared', () => {
    expect(
      defaultPair([
        output('a', '/out/run/AIFS', { written: false }),
        output('b', null),
        output('c', '/out/run/BRIS'),
      ]),
    ).toEqual({ a: 'a', b: 'b' })
  })

  it('skips a shared folder and a lost output', () => {
    expect(
      defaultPair([
        output('a', '/out/run'),
        output('b', '/out/run'),
        output('c', '/out/run/BRIS', { lost: true }),
        output('d', '/out/run/IFS'),
      ]),
    ).toEqual({ a: 'a', b: 'd' })
  })

  it('falls back to the first two when no pair can be compared', () => {
    expect(
      defaultPair([
        output('a', '/out/run'),
        output('b', '/out/run'),
        output('c', '/out/run'),
      ]),
    ).toEqual({ a: 'a', b: 'b' })
  })
})

describe('pickBlocker', () => {
  const other = output('b', '/out/run')

  it('allows an output in another folder, written or not', () => {
    expect(pickBlocker(output('c', '/out/run/IFS'), other)).toBeNull()
    expect(pickBlocker(output('c', null, { written: false }), other)).toBeNull()
  })

  it('blocks a lost output and one in the other side folder', () => {
    expect(pickBlocker(output('c', '/x', { lost: true }), other)).toBe('lost')
    expect(pickBlocker(output('c', '/out/run/'), other)).toBe('sharedFolder')
  })

  it('allows the other side own output, which swaps', () => {
    expect(pickBlocker(other, other)).toBeNull()
  })
})

describe('folderName', () => {
  it('returns the last path segment', () => {
    expect(folderName('/out/run/AIFS/')).toBe('AIFS')
    expect(folderName('AIFS')).toBe('AIFS')
  })
})
