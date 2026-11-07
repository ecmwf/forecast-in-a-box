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
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'
import { pickMatchedLens, setLensOwner } from '@/features/visualise/lens-owners'

const DIR = '/data/output/run-1__1'

function lens(
  id: string,
  status: LensInstanceDetailResponse['status'],
  path = DIR,
): LensInstanceDetailResponse {
  return {
    lens_instance_id: id,
    status,
    lens_name: 'skinnyWMS',
    lens_params: { local_path: path },
    ports: [19000],
  }
}

describe('pickMatchedLens', () => {
  beforeEach(() => localStorage.clear())

  it('prefers a running server on the folder over a starting one', () => {
    const list = [lens('a', 'starting'), lens('b', 'running')]
    expect(pickMatchedLens(list, DIR, 'run-1#1')?.lens_instance_id).toBe('b')
  })

  it('ignores other folders and dead servers', () => {
    const list = [lens('a', 'running', '/elsewhere'), lens('b', 'terminated')]
    expect(pickMatchedLens(list, DIR, 'run-1#1')).toBeUndefined()
  })

  it("skips another attempt's server but adopts unrecorded ones", () => {
    setLensOwner('a', 'run-1#2')
    expect(pickMatchedLens([lens('a', 'running')], DIR, 'run-1#1')).toBe(
      undefined,
    )
    expect(
      pickMatchedLens([lens('b', 'running')], DIR, 'run-1#1')?.lens_instance_id,
    ).toBe('b')
  })
})
