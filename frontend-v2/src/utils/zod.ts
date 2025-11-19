/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Zod utilities and helpers
 * Provides common validation patterns and error handling utilities
 */

import { z } from 'zod'
import type { $ZodIssue } from 'zod/v4/core'

/**
 * Custom error class for validation errors
 * Provides user-friendly error messages
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: z.ZodError,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Format Zod errors into user-friendly messages
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((err: $ZodIssue) => {
      const path = err.path.join('.')
      return path ? `${path}: ${err.message}` : err.message
    })
    .join('\n')
}

/**
 * Parse and throw with user-friendly error
 */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context?: string,
): z.infer<T> {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = context
        ? `Validation failed for ${context}:\n${formatZodError(error)}`
        : `Validation failed:\n${formatZodError(error)}`
      throw new ValidationError(message, error)
    }
    throw error
  }
}
