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
import { reservedGlyphReason } from '@/features/glyphs/utils/reserved-names'

const INTRINSICS = new Set(['runId', 'submitDatetime', 'attemptCount'])
const JINJA = new Set(['timedelta', 'floor_day', 'add_days'])

describe('reservedGlyphReason', () => {
  it('flags intrinsic glyph names', () => {
    expect(reservedGlyphReason('runId', INTRINSICS, JINJA)).toBe('intrinsic')
  })

  it('flags jinja filter/global names', () => {
    expect(reservedGlyphReason('timedelta', INTRINSICS, JINJA)).toBe('jinja')
  })

  it('intrinsic wins when a name is in both sets (backend check order)', () => {
    const both = new Set(['clash'])
    expect(reservedGlyphReason('clash', both, both)).toBe('intrinsic')
  })

  it('passes ordinary names', () => {
    expect(reservedGlyphReason('myVariable', INTRINSICS, JINJA)).toBeNull()
  })

  it('is case-sensitive like the backend sets', () => {
    expect(reservedGlyphReason('runid', INTRINSICS, JINJA)).toBeNull()
  })

  it('passes everything while the sets are still empty (loading)', () => {
    const empty = new Set<string>()
    expect(reservedGlyphReason('runId', empty, empty)).toBeNull()
  })
})
