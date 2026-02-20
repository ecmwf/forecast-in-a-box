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
import { z } from 'zod'
import type { $ZodIssue } from 'zod/v4/core'
import { ValidationError, formatZodError, parseOrThrow } from '@/utils/zod'

describe('ValidationError', () => {
  it('creates error with message and ZodError', () => {
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['name'],
        message: 'Expected string, received number',
      } as $ZodIssue,
    ])

    const error = new ValidationError('Test error', zodError)

    expect(error.message).toBe('Test error')
    expect(error.name).toBe('ValidationError')
    expect(error.errors).toBe(zodError)
  })

  it('is an instance of Error', () => {
    const zodError = new z.ZodError([])
    const error = new ValidationError('Test', zodError)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ValidationError)
  })
})

describe('formatZodError', () => {
  it('formats single error with path', () => {
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['name'],
        message: 'Expected string',
      } as $ZodIssue,
    ])

    expect(formatZodError(zodError)).toBe('name: Expected string')
  })

  it('formats error without path', () => {
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: [],
        message: 'Invalid input',
      } as $ZodIssue,
    ])

    expect(formatZodError(zodError)).toBe('Invalid input')
  })

  it('formats nested path with dots', () => {
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['user', 'profile', 'name'],
        message: 'Invalid',
      } as $ZodIssue,
    ])

    expect(formatZodError(zodError)).toBe('user.profile.name: Invalid')
  })

  it('formats multiple errors with newlines', () => {
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['name'],
        message: 'Expected string',
      } as $ZodIssue,
      {
        code: 'invalid_type',
        expected: 'number',
        path: ['age'],
        message: 'Expected number',
      } as $ZodIssue,
    ])

    expect(formatZodError(zodError)).toBe(
      'name: Expected string\nage: Expected number',
    )
  })
})

describe('parseOrThrow', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  })

  it('returns parsed data on success', () => {
    const data = { name: 'John', age: 30 }
    const result = parseOrThrow(schema, data)

    expect(result).toEqual({ name: 'John', age: 30 })
  })

  it('throws ValidationError on validation failure', () => {
    const data = { name: 123, age: 'invalid' }

    expect(() => parseOrThrow(schema, data)).toThrow(ValidationError)
  })

  it('includes formatted error message', () => {
    const data = { name: 123, age: 30 }

    try {
      parseOrThrow(schema, data)
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).message).toContain('Validation failed')
      expect((error as ValidationError).message).toContain('name')
    }
  })

  it('includes context in error message when provided', () => {
    const data = { name: 123, age: 30 }

    try {
      parseOrThrow(schema, data, 'user config')
    } catch (error) {
      expect((error as ValidationError).message).toContain(
        'Validation failed for user config',
      )
    }
  })

  it('re-throws non-Zod errors', () => {
    const throwingSchema = z.string().transform(() => {
      throw new Error('Custom error')
    })

    expect(() => parseOrThrow(throwingSchema, 'test')).toThrow('Custom error')
  })
})
