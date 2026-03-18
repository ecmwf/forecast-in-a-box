/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock console methods BEFORE importing the logger module
// This ensures the logger captures the mocked methods
const mockDebug = vi.fn()
const mockLog = vi.fn()
const mockWarn = vi.fn()
const mockError = vi.fn()

vi.stubGlobal('console', {
  ...console,
  debug: mockDebug,
  log: mockLog,
  warn: mockWarn,
  error: mockError,
})

// Import after mocking
const { createLogger, logger } = await import('@/lib/logger')

describe('createLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a scoped logger with prefix', () => {
    const log = createLogger('TestComponent')

    expect(log).toHaveProperty('debug')
    expect(log).toHaveProperty('info')
    expect(log).toHaveProperty('warn')
    expect(log).toHaveProperty('error')
  })

  it('debug method exists and is callable', () => {
    const log = createLogger('Test')
    expect(() => log.debug('test message')).not.toThrow()
    expect(mockDebug).toHaveBeenCalledWith('[Test] test message')
  })

  it('info method exists and is callable', () => {
    const log = createLogger('Test')
    expect(() => log.info('test message')).not.toThrow()
    expect(mockLog).toHaveBeenCalledWith('[Test] test message')
  })

  it('warn method exists and is callable', () => {
    const log = createLogger('Test')
    expect(() => log.warn('test message')).not.toThrow()
    expect(mockWarn).toHaveBeenCalledWith('[Test] test message')
  })

  it('error method exists and is callable', () => {
    const log = createLogger('Test')
    expect(() => log.error('test message')).not.toThrow()
    expect(mockError).toHaveBeenCalledWith('[Test] test message')
  })

  it('accepts additional data arguments', () => {
    const log = createLogger('Test')
    expect(() => log.info('message', { data: 'value' }, 123)).not.toThrow()
    expect(mockLog).toHaveBeenCalledWith(
      '[Test] message',
      { data: 'value' },
      123,
    )
  })
})

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has debug method', () => {
    expect(logger.debug).toBeDefined()
    expect(typeof logger.debug).toBe('function')
  })

  it('has info method', () => {
    expect(logger.info).toBeDefined()
    expect(typeof logger.info).toBe('function')
  })

  it('has warn method', () => {
    expect(logger.warn).toBeDefined()
    expect(typeof logger.warn).toBe('function')
  })

  it('has error method', () => {
    expect(logger.error).toBeDefined()
    expect(typeof logger.error).toBe('function')
  })

  it('debug accepts prefix, message, and data', () => {
    expect(() =>
      logger.debug('Prefix', 'message', { key: 'value' }),
    ).not.toThrow()
    expect(mockDebug).toHaveBeenCalledWith('[Prefix] message', { key: 'value' })
  })

  it('error logs are always output', () => {
    // Error logs should work regardless of environment
    logger.error('Test', 'error message')
    expect(mockError).toHaveBeenCalledWith('[Test] error message')
  })
})
