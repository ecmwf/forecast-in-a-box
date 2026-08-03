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
import { builderSessionKey } from '@/features/fable-builder/utils/builder-session-key'

describe('builderSessionKey', () => {
  it('changes when the blueprint changes', () => {
    expect(builderSessionKey({ fableId: 'bp-1' })).not.toBe(
      builderSessionKey({ fableId: 'bp-2' }),
    )
  })

  it('changes when the template flag flips on the same blueprint', () => {
    expect(builderSessionKey({ fableId: 'bp-1', template: true })).not.toBe(
      builderSessionKey({ fableId: 'bp-1' }),
    )
  })

  it('is stable for the blank-canvas route', () => {
    expect(builderSessionKey({})).toBe(builderSessionKey({}))
  })
})
