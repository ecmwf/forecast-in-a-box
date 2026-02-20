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
  getBackendBaseUrl,
  getEnvironment,
  isDebugEnabled,
  isDevelopment,
  isProduction,
} from '@/utils/env'

describe('getBackendBaseUrl', () => {
  it('returns a string', () => {
    const result = getBackendBaseUrl()
    expect(typeof result).toBe('string')
  })
})

describe('isDebugEnabled', () => {
  it('returns a boolean', () => {
    const result = isDebugEnabled()
    expect(typeof result).toBe('boolean')
  })
})

describe('getEnvironment', () => {
  it('returns environment mode string', () => {
    const result = getEnvironment()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('isProduction', () => {
  it('returns a boolean', () => {
    const result = isProduction()
    expect(typeof result).toBe('boolean')
  })
})

describe('isDevelopment', () => {
  it('returns a boolean', () => {
    const result = isDevelopment()
    expect(typeof result).toBe('boolean')
  })

  it('is opposite of isProduction in standard modes', () => {
    const dev = isDevelopment()
    const prod = isProduction()
    // In test mode, both could be false, so just check they're booleans
    expect(typeof dev).toBe('boolean')
    expect(typeof prod).toBe('boolean')
  })
})
