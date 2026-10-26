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
import type { ComparisonEntry } from '@/features/visualise/entry-ref'
import { slotCaption } from '@/features/visualise/slot-caption'

const output = (runName: string): ComparisonEntry => ({
  kind: 'output',
  jobId: 'job-1',
  taskId: 'task-1',
  blockId: 'block_sink_1',
  runName,
  blockTitle: 'Map Plot',
  runCreatedAt: '2026-09-14T06:23:10Z',
  addedAt: 0,
})

describe('slotCaption', () => {
  it('adds the submission time to a named run', () => {
    expect(slotCaption(output('AIFS Thailand'), 'UTC')).toEqual({
      label: 'AIFS Thailand',
      submittedAt: '14 Sep 06:23',
    })
  })

  it('drops the stamp a default job name already embeds', () => {
    expect(
      slotCaption(
        output('Anemoi Model Source · Map Plot · 2026-09-14 06:23'),
        'UTC',
      ),
    ).toEqual({
      label: 'Anemoi Model Source · Map Plot',
      submittedAt: '14 Sep 06:23',
    })
  })

  it('keeps a base-date suffix that is not the submission stamp', () => {
    expect(
      slotCaption(output('Anemoi Model Source · Map Plot · 2026-09-13'), 'UTC')
        .label,
    ).toBe('Anemoi Model Source · Map Plot · 2026-09-13')
  })

  it('leaves external servers alone', () => {
    const wms: ComparisonEntry = {
      kind: 'wms',
      url: 'https://x',
      label: 'ECMWF',
      addedAt: 0,
    }
    expect(slotCaption(wms, 'UTC')).toEqual({
      label: 'ECMWF',
      submittedAt: null,
    })
  })
})
