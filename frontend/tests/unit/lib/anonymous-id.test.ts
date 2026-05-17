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
import { isValidAnonymousId, readAnonymousId } from '@/lib/anonymous-id'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('isValidAnonymousId', () => {
  it('accepts a canonical UUID', () => {
    expect(isValidAnonymousId(VALID_UUID)).toBe(true)
  })

  it('accepts an uppercase UUID', () => {
    expect(isValidAnonymousId(VALID_UUID.toUpperCase())).toBe(true)
  })

  it('rejects null and the empty string', () => {
    expect(isValidAnonymousId(null)).toBe(false)
    expect(isValidAnonymousId('')).toBe(false)
  })

  it('rejects non-UUID values', () => {
    expect(isValidAnonymousId('undefined')).toBe(false)
    expect(isValidAnonymousId('not-a-uuid')).toBe(false)
    expect(isValidAnonymousId(`${VALID_UUID} trailing`)).toBe(false)
  })
})

describe('readAnonymousId', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the stored ID when it is a valid UUID', () => {
    localStorage.setItem(STORAGE_KEYS.auth.anonymousId, VALID_UUID)
    expect(readAnonymousId()).toBe(VALID_UUID)
  })

  it('returns null when nothing is stored', () => {
    expect(readAnonymousId()).toBeNull()
  })

  it('returns null when the stored value is not a valid UUID', () => {
    localStorage.setItem(STORAGE_KEYS.auth.anonymousId, 'tampered-value')
    expect(readAnonymousId()).toBeNull()
  })
})
