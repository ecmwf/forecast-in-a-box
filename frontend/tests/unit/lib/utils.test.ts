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
import { cn, isExternalUrl, isValidInternalRedirect } from '@/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    // Use a variable that eslint cannot statically analyze
    const condition = Math.random() > 2 // Always false but not statically known
    expect(cn('foo', condition && 'bar', 'baz')).toBe('foo baz')
  })

  it('handles undefined and null values', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })

  it('merges conflicting Tailwind classes correctly', () => {
    // twMerge should keep the last conflicting class
    expect(cn('p-4', 'p-8')).toBe('p-8')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles empty inputs', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
  })
})

describe('isValidInternalRedirect', () => {
  it('accepts valid internal paths', () => {
    expect(isValidInternalRedirect('/dashboard')).toBe(true)
    expect(isValidInternalRedirect('/users/profile')).toBe(true)
    expect(isValidInternalRedirect('/')).toBe(true)
    expect(isValidInternalRedirect('/path?query=value')).toBe(true)
  })

  it('rejects null and empty values', () => {
    expect(isValidInternalRedirect(null)).toBe(false)
    expect(isValidInternalRedirect('')).toBe(false)
  })

  it('rejects external URLs with protocols', () => {
    expect(isValidInternalRedirect('https://evil.com')).toBe(false)
    expect(isValidInternalRedirect('http://evil.com')).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    // Protocol-relative URLs can redirect to external sites
    expect(isValidInternalRedirect('//evil.com')).toBe(false)
    expect(isValidInternalRedirect('//evil.com/path')).toBe(false)
  })

  it('rejects URLs with backslashes (IE compatibility)', () => {
    // IE treats backslashes as forward slashes
    expect(isValidInternalRedirect('/foo\\bar')).toBe(false)
    expect(isValidInternalRedirect('\\\\evil.com')).toBe(false)
  })

  it('rejects relative paths without leading slash', () => {
    expect(isValidInternalRedirect('dashboard')).toBe(false)
    expect(isValidInternalRedirect('path/to/page')).toBe(false)
  })
})

describe('isExternalUrl', () => {
  it('identifies external URLs with https', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('https://example.com/path')).toBe(true)
  })

  it('identifies external URLs with http', () => {
    expect(isExternalUrl('http://example.com')).toBe(true)
  })

  it('identifies protocol-relative URLs as external', () => {
    expect(isExternalUrl('//example.com')).toBe(true)
    expect(isExternalUrl('//cdn.example.com/asset.js')).toBe(true)
  })

  it('identifies internal paths as non-external', () => {
    expect(isExternalUrl('/dashboard')).toBe(false)
    expect(isExternalUrl('/users/profile')).toBe(false)
    expect(isExternalUrl('/')).toBe(false)
  })

  it('identifies relative paths as non-external', () => {
    expect(isExternalUrl('dashboard')).toBe(false)
    expect(isExternalUrl('path/to/page')).toBe(false)
  })
})
