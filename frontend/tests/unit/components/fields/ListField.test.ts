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
import { isIntegerString } from '@/components/base/fields/fields/ListField'

describe('isIntegerString', () => {
  it('accepts positive integers', () => {
    expect(isIntegerString('0')).toBe(true)
    expect(isIntegerString('1')).toBe(true)
    expect(isIntegerString('42')).toBe(true)
    expect(isIntegerString('1000000')).toBe(true)
  })

  it('accepts negative integers', () => {
    expect(isIntegerString('-1')).toBe(true)
    expect(isIntegerString('-42')).toBe(true)
  })

  it('rejects floats', () => {
    expect(isIntegerString('1.5')).toBe(false)
    expect(isIntegerString('0.0')).toBe(false)
    expect(isIntegerString('-0.1')).toBe(false)
  })

  it('rejects non-numeric strings', () => {
    expect(isIntegerString('abc')).toBe(false)
    expect(isIntegerString('1a')).toBe(false)
    expect(isIntegerString('1 2')).toBe(false)
    expect(isIntegerString('')).toBe(false)
  })

  it('rejects whitespace and signs only', () => {
    expect(isIntegerString(' ')).toBe(false)
    expect(isIntegerString('-')).toBe(false)
    expect(isIntegerString('+')).toBe(false)
  })

  it('rejects leading + sign', () => {
    // Kept strict — backend parses plain digits
    expect(isIntegerString('+1')).toBe(false)
  })
})
