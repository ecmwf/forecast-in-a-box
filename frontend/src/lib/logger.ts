/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Centralized logging utility with environment-aware log levels.
 *
 * In development: All log levels are visible
 * In production: Only 'error' level logs are visible (unless VITE_DEBUG=true)
 *
 * Usage:
 * ```ts
 * import { createLogger } from '@/lib/logger'
 *
 * const log = createLogger('MyComponent')
 * log.debug('Debug message', { data })
 * log.info('Info message')
 * log.warn('Warning message')
 * log.error('Error message', error)
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Determines if a log at the given level should be output.
 * - In development: all levels are logged
 * - In production: only 'error' level (unless VITE_DEBUG=true)
 */
function shouldLog(level: LogLevel): boolean {
  const isDev = import.meta.env.DEV
  const debugEnabled = import.meta.env.VITE_DEBUG === 'true'

  // In production, only log errors unless debug is explicitly enabled
  if (!isDev && !debugEnabled) {
    return level === 'error'
  }

  return true
}

/**
 * Formats a log message with a prefix tag.
 */
function formatMessage(prefix: string, message: string): string {
  return `[${prefix}] ${message}`
}

/**
 * Maps log levels to console methods.
 */
const CONSOLE_METHODS = {
  debug: console.debug,
  info: console.log,
  warn: console.warn,
  error: console.error,
} as const

/**
 * Core logger object with methods for each log level.
 * Prefer using `createLogger()` to create a scoped logger.
 */
export const logger = {
  debug: (prefix: string, message: string, ...data: Array<unknown>): void => {
    if (shouldLog('debug')) {
      CONSOLE_METHODS.debug(formatMessage(prefix, message), ...data)
    }
  },

  info: (prefix: string, message: string, ...data: Array<unknown>): void => {
    if (shouldLog('info')) {
      CONSOLE_METHODS.info(formatMessage(prefix, message), ...data)
    }
  },

  warn: (prefix: string, message: string, ...data: Array<unknown>): void => {
    if (shouldLog('warn')) {
      CONSOLE_METHODS.warn(formatMessage(prefix, message), ...data)
    }
  },

  error: (prefix: string, message: string, ...data: Array<unknown>): void => {
    if (shouldLog('error')) {
      CONSOLE_METHODS.error(formatMessage(prefix, message), ...data)
    }
  },
}

/**
 * Logger interface returned by createLogger.
 */
export interface ScopedLogger {
  debug: (message: string, ...data: Array<unknown>) => void
  info: (message: string, ...data: Array<unknown>) => void
  warn: (message: string, ...data: Array<unknown>) => void
  error: (message: string, ...data: Array<unknown>) => void
}

/**
 * Creates a scoped logger with a fixed prefix.
 *
 * @param prefix - The prefix to prepend to all log messages (e.g., component or module name)
 * @returns A logger object with debug, info, warn, and error methods
 *
 * @example
 * ```ts
 * const log = createLogger('AuthProvider')
 * log.info('User logged in', { userId: '123' })
 * // Output: [AuthProvider] User logged in { userId: '123' }
 * ```
 */
export function createLogger(prefix: string): ScopedLogger {
  return {
    debug: (message: string, ...data: Array<unknown>) =>
      logger.debug(prefix, message, ...data),
    info: (message: string, ...data: Array<unknown>) =>
      logger.info(prefix, message, ...data),
    warn: (message: string, ...data: Array<unknown>) =>
      logger.warn(prefix, message, ...data),
    error: (message: string, ...data: Array<unknown>) =>
      logger.error(prefix, message, ...data),
  }
}
