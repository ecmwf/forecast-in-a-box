/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  decodeStateFromURL,
  encodeStateToURL,
  getCompressionStats,
  isStateTooLarge,
} from '@/lib/url-state'

// Mock logger to suppress expected error output in tests
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('encodeStateToURL', () => {
  it('encodes simple string', () => {
    const encoded = encodeStateToURL('hello')
    expect(typeof encoded).toBe('string')
    expect(encoded.length).toBeGreaterThan(0)
  })

  it('encodes object', () => {
    const state = { name: 'test', value: 42 }
    const encoded = encodeStateToURL(state)
    expect(typeof encoded).toBe('string')
  })

  it('encodes array', () => {
    const state = [1, 2, 3, 'a', 'b', 'c']
    const encoded = encodeStateToURL(state)
    expect(typeof encoded).toBe('string')
  })

  it('encodes complex nested object', () => {
    const state = {
      user: { name: 'John', age: 30 },
      settings: { theme: 'dark', notifications: true },
      items: [1, 2, 3],
    }
    const encoded = encodeStateToURL(state)
    expect(typeof encoded).toBe('string')
  })

  it('produces URL-safe string', () => {
    const state = { query: 'hello world', special: '&=?' }
    const encoded = encodeStateToURL(state)
    // Should not contain characters that need URL encoding
    expect(encoded).not.toMatch(/[+/=]/)
  })
})

describe('decodeStateFromURL', () => {
  const schema = z.object({
    name: z.string(),
    value: z.number(),
  })

  it('decodes valid encoded state', () => {
    const original = { name: 'test', value: 42 }
    const encoded = encodeStateToURL(original)
    const decoded = decodeStateFromURL(encoded, schema)

    expect(decoded).toEqual(original)
  })

  it('returns null for invalid encoded string', () => {
    const decoded = decodeStateFromURL('invalid-base64', schema)
    expect(decoded).toBeNull()
  })

  it('returns null for empty string', () => {
    const decoded = decodeStateFromURL('', schema)
    expect(decoded).toBeNull()
  })

  it('returns null when schema validation fails', () => {
    const wrongSchema = z.object({
      different: z.string(),
    })

    const original = { name: 'test', value: 42 }
    const encoded = encodeStateToURL(original)
    const decoded = decodeStateFromURL(encoded, wrongSchema)

    expect(decoded).toBeNull()
  })

  it('validates types according to schema', () => {
    const strictSchema = z.object({
      count: z.number().min(0).max(100),
      enabled: z.boolean(),
    })

    const valid = { count: 50, enabled: true }
    const encoded = encodeStateToURL(valid)
    const decoded = decodeStateFromURL(encoded, strictSchema)

    expect(decoded).toEqual(valid)
  })

  it('handles nested objects', () => {
    const nestedSchema = z.object({
      user: z.object({
        name: z.string(),
      }),
      items: z.array(z.number()),
    })

    const original = { user: { name: 'John' }, items: [1, 2, 3] }
    const encoded = encodeStateToURL(original)
    const decoded = decodeStateFromURL(encoded, nestedSchema)

    expect(decoded).toEqual(original)
  })
})

describe('isStateTooLarge', () => {
  it('returns false for small encoded string', () => {
    const encoded = encodeStateToURL({ a: 1 })
    expect(isStateTooLarge(encoded)).toBe(false)
  })

  it('returns true for very large encoded string', () => {
    // LZ compression is very effective, so we need truly random-ish data
    // to defeat compression and exceed 1800 characters
    const largeState = {
      data: Array(500)
        .fill(0)
        .map((_, i) => ({
          id: `unique-id-${i}-${Math.random().toString(36)}`,
          timestamp: Date.now() + i,
          value: Math.random().toString(36).substring(2, 15),
          nested: {
            field1: `value-${i}-${Math.random()}`,
            field2: i * Math.random(),
          },
        })),
    }
    const encoded = encodeStateToURL(largeState)
    expect(encoded.length).toBeGreaterThan(1800)
    expect(isStateTooLarge(encoded)).toBe(true)
  })

  it('uses 1800 character threshold correctly', () => {
    // Test just under threshold
    const smallEncoded = 'a'.repeat(1800)
    expect(isStateTooLarge(smallEncoded)).toBe(false)

    // Test just over threshold
    const largeEncoded = 'a'.repeat(1801)
    expect(isStateTooLarge(largeEncoded)).toBe(true)
  })
})

describe('getCompressionStats', () => {
  it('returns original and compressed sizes', () => {
    const state = { name: 'test', value: 42 }
    const stats = getCompressionStats(state)

    expect(stats.originalSize).toBeGreaterThan(0)
    expect(stats.compressedSize).toBeGreaterThan(0)
    expect(typeof stats.ratio).toBe('number')
  })

  it('calculates correct original size', () => {
    const state = { name: 'test' }
    const stats = getCompressionStats(state)

    expect(stats.originalSize).toBe(JSON.stringify(state).length)
  })

  it('calculates correct compressed size', () => {
    const state = { name: 'test' }
    const stats = getCompressionStats(state)
    const encoded = encodeStateToURL(state)

    expect(stats.compressedSize).toBe(encoded.length)
  })

  it('calculates compression ratio', () => {
    const state = { name: 'test' }
    const stats = getCompressionStats(state)

    expect(stats.ratio).toBe(stats.compressedSize / stats.originalSize)
  })

  it('shows compression benefit for repetitive data', () => {
    const repetitiveState = {
      items: Array(100)
        .fill(0)
        .map(() => ({
          type: 'item',
          status: 'active',
          category: 'default',
        })),
    }
    const stats = getCompressionStats(repetitiveState)

    // LZ compression should be effective for repetitive data
    expect(stats.ratio).toBeLessThan(1)
  })
})

describe('round-trip encoding/decoding', () => {
  it('preserves data through encode/decode cycle', () => {
    const testCases = [
      { schema: z.string(), data: 'hello world' },
      { schema: z.number(), data: 42 },
      { schema: z.boolean(), data: true },
      { schema: z.array(z.number()), data: [1, 2, 3, 4, 5] },
      {
        schema: z.object({ name: z.string(), age: z.number() }),
        data: { name: 'John', age: 30 },
      },
    ]

    for (const { schema, data } of testCases) {
      const encoded = encodeStateToURL(data)
      // Cast to z.ZodSchema<unknown> since we're testing multiple schema types
      const decoded = decodeStateFromURL(
        encoded,
        schema as z.ZodSchema<unknown>,
      )
      expect(decoded).toEqual(data)
    }
  })

  it('handles special characters', () => {
    const schema = z.object({
      text: z.string(),
    })

    const specialChars = {
      text: 'Hello & goodbye! Special: <>&"\' Unicode: ',
    }
    const encoded = encodeStateToURL(specialChars)
    const decoded = decodeStateFromURL(encoded, schema)

    expect(decoded).toEqual(specialChars)
  })

  it('handles unicode characters', () => {
    const schema = z.object({
      greeting: z.string(),
    })

    const unicode = { greeting: '' }
    const encoded = encodeStateToURL(unicode)
    const decoded = decodeStateFromURL(encoded, schema)

    expect(decoded).toEqual(unicode)
  })
})
