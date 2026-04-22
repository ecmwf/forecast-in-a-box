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
  applyFloorDay,
  canApplyFloorDay,
  previewHasTimeComponent,
} from '@/features/fable-builder/utils/date-preview-nudge'

describe('previewHasTimeComponent', () => {
  it('returns true for YYYY-MM-DD HH:MM:SS with non-zero time', () => {
    expect(previewHasTimeComponent('2026-04-20 10:49:06')).toBe(true)
  })

  it('returns true for YYYY-MM-DD HH:MM (no seconds, non-zero)', () => {
    expect(previewHasTimeComponent('2026-04-20 10:49')).toBe(true)
  })

  it('returns true for the ISO T-separated form with non-zero time', () => {
    expect(previewHasTimeComponent('2026-04-20T10:49:06')).toBe(true)
  })

  it('returns false when the time is exactly midnight (HH:MM:SS all zero)', () => {
    expect(previewHasTimeComponent('2026-04-20 00:00:00')).toBe(false)
  })

  it('returns false when the time is midnight without seconds', () => {
    expect(previewHasTimeComponent('2026-04-20 00:00')).toBe(false)
  })

  it('returns false for the ISO form at midnight', () => {
    expect(previewHasTimeComponent('2026-04-20T00:00:00')).toBe(false)
  })

  it('returns true when only minutes are zero but hours are not', () => {
    expect(previewHasTimeComponent('2026-04-20 10:00:00')).toBe(true)
  })

  it('returns true when only seconds are non-zero', () => {
    expect(previewHasTimeComponent('2026-04-20 00:00:01')).toBe(true)
  })

  it('returns false for a bare date', () => {
    expect(previewHasTimeComponent('2026-04-20')).toBe(false)
  })

  it('returns false for plain text', () => {
    expect(previewHasTimeComponent('hello world')).toBe(false)
  })
})

describe('canApplyFloorDay', () => {
  it('is true when the value is a single `${...}` expression', () => {
    expect(canApplyFloorDay('${submitDatetime}')).toBe(true)
    expect(canApplyFloorDay('${submitDatetime | sub_days(2)}')).toBe(true)
  })

  it('is false when the expression already pipes through floor_day', () => {
    expect(canApplyFloorDay('${submitDatetime | floor_day}')).toBe(false)
    expect(
      canApplyFloorDay('${submitDatetime | floor_day | sub_days(2)}'),
    ).toBe(false)
  })

  it('is false when there is text around the expression', () => {
    expect(canApplyFloorDay('prefix-${submitDatetime}')).toBe(false)
    expect(canApplyFloorDay('${submitDatetime}-suffix')).toBe(false)
  })

  it('is false when there are multiple expressions', () => {
    expect(canApplyFloorDay('${a} and ${b}')).toBe(false)
  })

  it('is false when the value has no expressions at all', () => {
    expect(canApplyFloorDay('2026-04-20')).toBe(false)
    expect(canApplyFloorDay('')).toBe(false)
  })
})

describe('applyFloorDay', () => {
  it('appends `| floor_day` to a plain variable', () => {
    expect(applyFloorDay('${submitDatetime}')).toBe(
      '${submitDatetime | floor_day}',
    )
  })

  it('appends after any existing filter chain', () => {
    expect(applyFloorDay('${submitDatetime | sub_days(2)}')).toBe(
      '${submitDatetime | sub_days(2) | floor_day}',
    )
  })

  it('is a no-op when the expression already uses floor_day', () => {
    const value = '${submitDatetime | floor_day}'
    expect(applyFloorDay(value)).toBe(value)
  })

  it('is a no-op when the value has surrounding text', () => {
    const value = 'prefix-${submitDatetime}'
    expect(applyFloorDay(value)).toBe(value)
  })
})
